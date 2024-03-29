import {EventEmitter} from 'events';
import { getMotion } from './utils.js';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:motor' + '\t');

// Error codes 
const codes = ['OC', 'DRV', 'ENC', 'LAG', 'COM', 'MNE', 'ESTOP', 'TEMP'];

// Parameter index mapping
const parameterMapping = ['board', 'motor', 'axis', 'control', 'com'];

// Parameter subindex mapping
const subindexMapping = {
  board: ['serialNo', 'firmwareversion', 'hardwareNo', 'minVoltage', 'maxTemp'],
  motor: ['encoderTics', 'poleParis', null, null, 'maxRpm', 'maxTemp', 'maxCurrent', 'startUpMethod', null, 'encoderInverted'],
  axis: [null, 'referenceType', 'referenceOffset', 'referenceSpeed', 'referenceSpeedSlow', 'referenceSwitchType', 'maxPos', 'breakType'],
  control: [],
  com: ['canMaxMisses', 'canIdSource', 'canId', 'spiActive']
}

// Helper
function dec2bin(dec) {
  // dec = 26 
  // decoded = '00011010'
  return (dec >>> 0).toString(2).padStart(8, '0');
}

const RATIO = 3.25;

/**
 * Igus motor controller
 * 
 * This motor controller is based on the CPR_CAN_Protocol_V2 guide linked below
 * 
 * https://cpr-robots.com/download/CAN/CPR_CAN_Protocol_V2_UserGuide_en.pdf
 */
export class Motor extends EventEmitter   {

  /** -----------------------------------------------------------
   * Constructor
   */
  constructor({ id, canId, channel, cycleTime = 50, limNeg = -180, limPos = 180, accelEnabled = true, offset = 0, flip = false, gearRatio = 50 }) {

    logger(`creating motor ${id} with canId ${canId}`);

    // Becasuse we are event emitter
    super();

    // Define parameters
    this.id = id;                             // motor id
    this.canId = canId;                       // motor canId
    this.homing = false;                      // if motor is process of homing
    this.home = false;                        // if the motor is currently home
    this.ready = false;                       // if motor is ready
    this.enabled = false;                     // if motor is enabled
    this.cycleTime = cycleTime;               // in ms .. example: 50ms
    this.cyclesPerSec = 1000/this.cycleTime;  // how many cycles per second  
    //this.gearScale = 1031.11;               // scale for iugs Rebel joint = Gear Ratio x Encoder Ticks / 360 = Gear Scale 
    this.gearScale = Math.round( (gearRatio * 7424 / 360) * 100 ) / 100;
    this.encoderTics = 7424;					        // tics per revolution
    this.maxVelocity = 45;                    // degree / sec
    this.maxAccel    = 40;                    // max accel in deg/s
    this.velocity = this.maxVelocity * RATIO; // Initial velocity is max
    this.currentVelocity = this.velocity;     // the current velocity ( will grow and shrink based on acceleration )       
    this.acceleration = this.maxAccel * RATIO;// The acceleration in degree / sec
    this.accelEnabled = accelEnabled;         // If acceleration/deceleration is enabled
    this.motionScale = 0.22;                  // Scales the motion velocity
    this.limPos = limPos;                     // the limit in posative direction in degrees
    this.limNeg = limNeg;                     // the limit in negative direction in degrees
    this.digitalOut = 0;                      // the wanted digital out channels
    this.digitalIn = 0;                       // the current digital int channels
    this.goalPosition = null;                 // The joint goal position in degrees
    this.currentPosition  = null;             // the current joint positions in degree, loaded from the robot arm
    this.currentTics = null;                  // the current position in tics loaded from motor 
    this.jointPositionSetPoint = null;        // The set point is a periodicly updated goal point 
    this.timeStamp = 0;                       // For message ordering 
    this.motorCurrent = 0;                    // Motor current in mA
    this.errorCode = 0;                       // the error state of the joint module
    this.errorCodeString;                     // human readable error code for the joint module
    this.stopped = true;                      // will disable position sends
    this.robotStopped = false;                // the motor might stop things but the robot might also have stop set
    this.gearZero = 0;                        // zero pos for gear
    this.encoderPulsePosition = null;         // the current joint position in degrees sent by the heartbeat from motor 
    this.encoderPulseTics = null;
    this.parameters = { board: {}, motor: {}, axis: {}, control: {}, com: {} };             // A place to store any read parameters 
    this.calculatedVelocity = 0;
    this.offset = offset;
    this.encoderOffset = 0;
    this.flip = flip;
    this.moving = false;                      // if motor is in motion
    this.zeroed = false;                      // if this motor has been zeroed out yet
    this.referenced = 0;                      // if this motor has been referenced
    this.aligned = 0;                         // if the motor has been aligned

    // Our can channel
    this.channel = channel;

    logger(`Motor ${this.id} has gearScale of ${this.gearScale}`);

    // Start up
    this.start();
  }

  /** ---------------------------------
   * Subscribe to all events from motor
   */
  start() {

    // Add subscription but only for our messages
    this.channel.addListener("onMessage", (msg) => {

      if(msg.id === this.canId + 1) {
        this.handleMotionMessage(msg) 
      }
      if(msg.id === this.canId + 2) {
        this.handleProcessMessage(msg) 
      }
      if(msg.id === this.canId + 3) {
        this.handleEnvironmentalMessage(msg) 
      }
    });

    // Enable the motor
    //this.stopped = false;

    // We are ready
    logger(`motor with id ${this.id} is ready`);
    this.ready = true;
    this.emit('ready');
  }

  /** ---------------------------------
   * Handles any motion messages
   */
  handleMotionMessage(msg) {

    // get the buffer
    const buff = msg.data

    // Special case for parameter read event
    if( buff[0] == 0x96 ){
      const index = buff[1];
      const subindex = buff[2];
      const data = buff.readIntBE(3,4);
      console.log(buff);
      logger(`Parameter Read index: ${index}, subindex: ${subindex}, data: ${data}`);
      const section = parameterMapping[index];
      const parameter = subindexMapping[section][subindex];
      this.parameters[section][parameter] = data;
    } else { 
      // err pos0 pos1 pos2 pos3 currentH currentL din 
      this.errorCode = buff[0];
      this.errorCodeString = this.decodeError(this.errorCode);
      const pos = buff.readIntBE(1, 4); // TODO might need this? .toString(10); 

      const newPos = (pos - this.gearZero) / this.gearScale;
			const newTimestamp = Date.now();
      this.calculatedVelocity = (this.currentPosition - newPos) / ( newTimestamp - this.reportTimestamp) * 1000;
      this.currentPosition = (pos - this.gearZero) / this.gearScale;
      this.reportInterval = newTimestamp - this.reportTimestamp;
			this.reportTimestamp = newTimestamp;
      //this.currentPosition = ( 360 / this.encoderTics ) * pos;
      this.currentTics = pos;
      this.motorCurrent = buff[6];
      this.decodeFlags(buff[7]);

      // If we dont have goal or setPoint set to currentPosition
      if( this.goalPosition == null ){
        logger(`Motor ${this.id} is updating its goal to ${this.currentPosition}`);
        this.goalPosition = this.currentPosition;
        this.jointPositionSetPoint = this.currentPosition;
      }

      // TODO this is close to working but need more effort
      if(this.admittanceEnabled && !this.moving && Math.abs(this.calculatedVelocity) > 0.01 ){
        this.moving = true;
        //const nextPos = this.currentPosition + ( this.flip ? -1 : 1);
        const rate = this.calculatedVelocity < 0 ? -1 : 1;
        const nextPos = this.flip ? -this.currentPosition + rate : this.currentPosition + rate;
        logger(`Motor ${this.id} adding steps vel ${this.calculatedVelocity} current ${this.currentPosition} next ${nextPos}`);
        this.setPosition(nextPos, 20);
      }

      // This is to fast so we just have interval in the robot
      //this.emit('encoder');
    }
  }

  /** ---------------------------------
   * Handles any process messages
   */
  handleProcessMessage(msg) {
    const buff = msg.data

    // Error pulse message ( sent every second )
    if(buff[0] == 0xE0){
      const motorError = buff[1];
      const adcError = buff[2];
      const rebelError = buff[3];
      const controlError = buff[4];
      if( motorError || adcError || rebelError || controlError ){
        //logger(`Error motor ${this.id}`, buff[1], buff[2], buff[3], buff[4]);
        this.motorError = motorError;
        this.adcError = adcError;
        this.rebelError = rebelError;
        this.controlError = controlError;
      } else {
        // We have no error so clear it
        this.motorError = undefined;
        this.adcError = undefined;
        this.rebelError = undefined;
        this.controlError = undefined;
      }
    } 

    //if(buff[0] == 0x06){
    //  logger(`Motor ${this.id} got referencing error ${buff}`);
    //}

    if(buff[0] == 0xEF){

      // Position of the output drive in deg / 100
      let pos = buff.readIntBE(4, 4);

      let inDegrees = pos / 100;

      // Bug at 180deg initialization
      if(Math.abs(inDegrees) === 180){
        // TODO we should remove this when we figure out whats going on ( maybe its not needed anymore )
        logger(`Motor ${this.id} reporting position ${pos} but in fact its at 0`)
        pos = 0;
        inDegrees = 0;
      }

      if( this.encoderPulsePosition == null ){

        // inDegrees is how far away from REAL zero we are
        // Example: inDegrees = -40 
        // We want our current position to take that into consideration
        // therefore, we are going to add on an offset 
        // Example 0 + -40 = -40... therefore if we set position to 10deg
        // 10 - (-40) = 50  
        this.encoderOffset = inDegrees;
        logger(`Motor ${this.id} is ${inDegrees} degrees away from true zero, setting encoderOffset to ${this.encoderOffset}`);

        // First time so initialize the current pos to this
        this.currentPosition = inDegrees;
				this.currentTics = pos;
        this.goalPosition = inDegrees;

        // Need to initialize the direction we will move to get to start goal ( 0 )
        this.backwards = this.goalPosition < this.currentPosition;
        //this.stopped = false;
        logger(`Motor ${this.id} start canid: ${this.canId} position ${this.currentPosition}`)
      }
      
      // Now update this value every time
      this.encoderPulsePosition = inDegrees;
      this.encoderPulseTics = pos;
      //console.log(`${this.id} PULSE`, inDegrees);
      // TODO maybe add back some day
      //this.emit('pulse', this.id, inDegrees);
    }

  }


  handleEnvironmentalMessage(msg){
    const buff = msg.data;
    this.voltage = buff.readUIntBE(2,2);
    this.tempMotor = buff.readUIntBE(4,2);
    this.tempBoard = buff.readUIntBE(6,2);
  }

  /** ---------------------------------
   * decodes error into readable string
   */
  decodeError(error){
    // Example: 
    // error = 26 
    // decoded = '00011010'
    const decoded = dec2bin(error);

    // TEMP Over temperature - The temperature of the motor controller or the motor is above the defined value in the parameters.
    // ESTOP Emergency stop / no voltage - The voltage at the motor controller is below the set limit value. This may indicate a defective fuse or emergency stop.
    // MNE Motor not activated - The movement of the motor is not enabled, it is not in control.
    // COM Communication failure  - The motor controller requires CAN messages at regular intervals. If the distance between the messages is too large or the messages do not arrive, the motor controller stops the movement.
    // LAG Following error - The motor controller monitors the following error, if this is greater than the value set in the parameters, the motor controller stops the movement.
    // ENC Encoder error - The motor controller has detected an encoder error. Errors can be triggered by both the motor or the output encoder.
    // DRV Driver error - A driver error can have various causes. One possible cause is exceeding the maximum speed from the parameters. With the closedloop motor controllers, the error also occurs with problems with the initial rotor position.
    // OC Over current - The RMS current in the motor controller was above the allowed value in the parameters.

    // OC DRV ENC LAG COM MNE ESTOP TEMP
    // Example:
    // 0   0   0   1   1   0    1    0'
    //            LAG COM      ESTOP
    //
    // codes = ['OC', 'DRV', 'ENC', 'LAG', 'COM', 'MNE', 'ESTOP', 'TEMP'];

    let result = '';
    for( let i = 0; i < 8; i++ ){ 
      if(decoded[i] != '0'){
        result += `${codes[i]},`
      }
    }

    // LAG,COM,ESTOP
    return result;
  }

  /** ---------------------------------
   * decodes flags
   */
  decodeFlags(flags){
    // Example: 
    // error = 0x42 
    // decoded = '01000010'
    const decoded = dec2bin(flags);

    // [ REF ] [  ALIGN ]  [     UNUSED    ] [         DIN         ]   
    this.referenced = +decoded[0];
    this.aligned = +decoded[1];
  }


  /** ---------------------------------
   * Will write out the pos values for joint 
   */
  writeJointSetPoints(){
 
    // If we are are stopped then dont send anything
    if(this.stopped || this.robotStopped){
      return;
    }

    // How far are we from our goal
    const distance = Math.abs(this.goalPosition - this.currentPosition);

    //console.log(`GOAL ${this.goalPosition} CURRENT ${this.currentPosition} DISTANCE ${distance}`);    
   
    // Slow down when we are within 5 degrees
    if( distance < 2 && !this.accelEnabled ) {
      this.currentVelocity = 10 * RATIO;
    }
     
    // If we are within tolerance just set set point to there
    const TOLERANCE = 0.5;

		if( distance < TOLERANCE ){
      // Set point to goal
			this.jointPositionSetPoint = this.goalPosition;
      // When we are really close just callit quits
      if( distance < 0.1 ) { 
        this.jointPositionSetPoint = this.currentPosition;
        // If we are here we are done moving
        if( this.moving && this.calculatedVelocity === 0 ){ // NOTE: I added the calculated velocity check for admittance ( might remove in future )
          logger(`Motor ${this.id} is done moving.`);
          this.moving = false;
          this.emit('moved', this.id);
        }
      }
		} else if( this.enabled )  {

      // Basically we are increasing the goal degs by our movement segments
      //
      // note: we may have case where we are going from 45 to 40 where the dif is 40 - 45 ===> -5
      // in this case we want to go other direction
      const neg = this.goalPosition < this.currentPosition;


      /*---------------------------------- For ACCEL -------------------------------------------*/

      // Determine if we are past the deccel point
      const past = neg ? this.currentPosition < this.deccelAt : this.currentPosition > this.deccelAt;

      //console.log('PAST', past);

      // Here we either accel or deccel based on where we are
      if( this.accelEnabled && this.deccelAt && past ){
        // Decellerate
        //console.log('DECELERATING', this.currentPosition);
        this.currentVelocity = this.currentVelocity - ( this.acceleration / this.cyclesPerSec );
      } else if(  this.accelEnabled && this.currentVelocity < this.velocity && !past ){
        // Accelerate
        //console.log('ACCELERATING', this.currentPosition);
        // We want to accelerate and decelerate the motor over the course of its delta to goal
        // acceleration is in °/s && Example: there are 20 cycles in 1 second
        // therefore we break acceleration down by 20, increasing by 1/20th every cycle 
        this.currentVelocity = this.currentVelocity + ( this.acceleration / this.cyclesPerSec );
      } else if( this.accelEnabled ) { 
        //console.log('CRUSING', this.currentPosition);
        this.currentVelocity = this.velocity;
      }

      // Safety check, we don't want to go over set velocity
      if( this.currentVelocity > this.velocity ){
       	this.currentVelocity = this.velocity;
      }

      /*----------------------------------------------------------------------------------------*/

      // vel ist in °/s so we need to break it down into our cycle segments
      // Example: (50 / 1000 ) * 45 = 2.25 deg per cycle
      const rate  = (this.cycleTime / 1000.0) * this.currentVelocity; 

      // Our motor cant nessisarily move 2.25 deg per 50 ms so we need to scale it down
      // Example: 2.25 °/tic * 0.3 = 0.675 °/tic
      // const movement = rate * this.motionScale; 

      this.jointPositionSetPoint = this.currentPosition + ( neg ? -rate : rate);
    } 

    // generate the pos in encoder tics instead of degrees
    const pos = (this.gearZero + this.jointPositionSetPoint) * this.gearScale; 
    
    // Update the set tics
    this.jointPositionSetTics = pos;

    // Update the timestamp keeping it between 0-255 
    this.timeStamp = this.timeStamp === 255 ? 0 : this.timeStamp + 1;

    // write the setPoint command to the CAN bus
    //
    // 0x14 vel pos0 pos1 pos2 pos3 timer digital_out
    
    // Create buffer for data
    const buff = Buffer.alloc(8)

    //console.log('POS', pos); 
         
    // Set data 
    buff[0] = 0x14;                                           // First byte denominates the command, here: set joint position
    buff[1] = 0x00;                                           // Velocity, not used
    buff.writeIntBE(pos, 2, 4)                                // Write the position to the data 
    buff[6] = this.timeStamp;                                 // Time stamp (not used)
    buff[7] = 0;                                              // Digital out for this module, binary coded
  
    // Create our output frame
    const out = {
      id: this.canId,
      data: buff
    };

  
    const newTimestamp = Date.now();
    this.sendInterval = newTimestamp - this.sendTimestamp;
	  this.sendTimestamp = newTimestamp;
  
    // Send that shit!
    this.channel.send(out)
  }

  /** ---------------------------------
   * Will set the position
   * 
   * @param {number} position - Position to go in degrees
   * @param {number} [velocity] - velocity in degrees / sec
   */
  setPosition( pos, velocity = this.maxVelocity, acceleration = this.maxAccel ) {

    if( !this.referenced && !this.zeroed ){
      logger(`Error: This motor is not referenced and cant move. Please reference before moving..`);
      this.error = "NOT_REFERENCED/CANT_MOVE";
      return;
    }

    let position = pos;

    if( this.flip ) {
      position = -position;
      position = position - this.offset;
    } else { 
      position = position + this.offset;
    }

		// Safety check ( don't allow set pos to an angle outside the limits )
    if( pos > this.limPos || pos < this.limNeg ){
      logger(`ERROR: motor ${this.id} set position to ${pos}º is outside the bounds of this motor!!!`);
      this.error = 'OUT_OF_BOUNDS';
      this.emit('motorError');
      return;
    }

    // We are now considered to be moving so set this flag
    this.moving = true;

    logger(`Motor ${this.id} Set Pos to ${pos} actual ${position} velocity ${velocity} acceleration ${acceleration}`);

    // Until we figure out the ratio issue we need to do this
    this.velocity = velocity ? velocity * RATIO : this.velocity;
    this.acceleration = acceleration ? acceleration * RATIO : this.acceleration;

    // Update the values before movment
    this.currentVelocity = this.accelEnabled ? 0 : this.velocity;
    this.goalPosition = position;
    this.backwards = this.goalPosition < this.currentPosition;
    this.deccelAt = null;

    // Get the motion information ( need to determine where to start decellerating )
    const { DECCEL, MESSAGE } = getMotion(this, pos, velocity, acceleration );
   
    // The deccelAt position is an offset from current pos
    this.deccelAt = this.backwards ? this.currentPosition - DECCEL : this.currentPosition + DECCEL; 

    logger(MESSAGE);
    logger(`Determined we are going to start deccel at ${this.deccelAt}`);

    logger(`Goal: ${this.goalPosition}, Current ${this.currentPosition}, Backwards: ${this.backwards}`);
  }

  /** ---------------------------------
   * Will home the motor ( send it to zero )
   */
  goHome() {
    logger(`motor ${this.id} starting to home`);
    this.homing = true;
    this.setPosition(0);
  }

  /** ---------------------------------
   * Will zero the motor
   */
  zero() {
    logger(`zero motor with id ${this.id}`);

    // Stop sending pos updates
    this.stopped = true;

    // Whenever we zero we have new encoder offset
    this.goalPosition = null;
    this.jointPositionSetPoint = null;
    this.encoderOffset = this.encoderPulsePosition;
    logger(`Motor ${this.id} is ${this.encoderOffset} degrees away from true zero, setting encoderOffset to ${this.encoderOffset}`);

    // We are starting to home
    this.emit('zero');

    // Create buffer for data
    const buff = Buffer.alloc(4)

    buff[0] = 0x01;
    buff[1] = 0x08;
    buff[2] = 0x00;
    buff[3] = 0x00;

    // Create our output frame
    const out = {
      id: this.canId,
      data: buff
    };

    // Send first frame
    this.channel.send(out);

    // Wait 1 ms
    setTimeout(() => {
      this.channel.send(out); // Send second frame
      // Wait 5 ms
      setTimeout(() =>{
        this.stopped = false; // Re enable sending pos updates
        this.zeroed = true;   // We have been zeroed!
      }, 5);
    }, 1)


  }

  /** ---------------------------------
   * Will calibrate the motor ( for rotor orientation )
   */
  calibrate() {
    logger(`calibrating motor with id ${this.id}`);

    // We are starting to home
    this.emit('calibrating');

    // Create buffer for data
    const buff = Buffer.alloc(2)

    buff[0] = 0x01;
    buff[1] = 0x0C;

    // Stop sending pos updates
    this.stopped = true;
    
    // Create our output frame
    const out = {
      id: this.canId,
      data: buff
    };

    // Send first frame
    this.channel.send(out);

    // Wait 1 ms
    setTimeout(() => {
      this.channel.send(out); // Send second frame
      // Wait 5 ms
      setTimeout(() =>{
        this.stopped = false; // Re enable sending pos updates
      }, 5);
    }, 1)

  }

  /** ---------------------------------
   * Will reference the motor
   */
  reference() {
    logger(`referencing motor with id ${this.id}`);

    // Stop sending pos updates
    this.stopped = true;

    // Whenever we reference we have new encoder offset, zero, as current will now equal actual
    this.goalPosition = null;
    this.jointPositionSetPoint = null;
    this.encoderOffset = 0;
    logger(`Motor ${this.id} is ${this.encoderOffset} degrees away from true zero, setting encoderOffset to ${this.encoderOffset}`);

    // We are starting to reference
    this.emit('referencing');

    // Create buffer for data
    const buff = Buffer.alloc(2)

    buff[0] = 0x01;
    buff[1] = 0x0B;

    // Create our output frame
    const out = {
      id: this.canId,
      data: buff
    };

    // Send first frame
    this.channel.send(out);

    // Wait 1 ms
    setTimeout(() => {
      this.channel.send(out); // Send second frame
      // Wait 5 ms
      setTimeout(() =>{
        this.stopped = false; // Re enable sending pos updates
      }, 5);
    }, 1)

  }



  /** ---------------------------------
   * Enable the Motor
   * The Motor has to be in 0x04 or 00000100 = MNE Motor not enabled state.
   * This is the state after "reset"
   * 
   */
  enable() {

    logger(`enabling motor with id ${this.id} error code is currently ${dec2bin(this.errorCode)}`);

    if( !this.referenced ){
      logger(`Error: This motor is not referenced.`);
      this.error = "NOT_REFERENCED";
      //return;
    }

    if( dec2bin(this.errorCode)[5] != '1' ){
      const errorMessage = `Error: Please reset ${this.id} before enabling`
      logger(errorMessage);
      this.error = "NO_RESET";
      //this.emit('error', errorMessage);
    } else { 

      // Protocol: 0x01 0x09 to enable a joint
      //           0x01 0x0A to disable a joint

      // Create buffer for data
      const buff = Buffer.alloc(2)

      buff[0] = 0x01;
      buff[1] = 0x09;

      // Stop sending pos updates
      this.stopped = true; 

      // Create our output frame
      const out = {
        id: this.canId,
        data: buff
      };

      // Send frame
      this.channel.send(out);
    
      // Wait 5 ms
      setTimeout(() => {
        this.enabled = true;
        this.stopped = false; // Re enable sending pos updates
        this.emit('enabled');
      }, 5)
    }
  }

  /** ---------------------------------
   * Disable the Motor
   * 
   */
  disable() {

    logger(`disabling motor with id ${this.id}`);


      // Protocol: 0x01 0x09 to enable a joint
      //           0x01 0x0A to disable a joint

      // Create buffer for data
      const buff = Buffer.alloc(8)

      buff[0] = 0x01;
      buff[1] = 0x0A;

      // Stop sending pos updates
      this.stopped = true; 

      // Create our output frame
      const out = {
        id: this.canId,
        data: buff
      };

      // Send frame
      this.channel.send(out);

      this.enabled = false;
      this.stopped = true;
      this.moving = false;
    
      // Wait 5 ms
      setTimeout(() => {
        this.emit('disabled');
      }, 5)
  }

  /** ---------------------------------
   * Resets the errors of the joint module. Error will be 0x04 afterwards (motors not enabled)
   * You need to enable the motors afterwards to get the robot in running state (0x00)
   * 
   */
  reset() {

    logger(`resetting errors for motor with id ${this.id}`);

    // Stop sending pos updates
    this.stopped = true; 

    // Clear error code
    this.error = null;
    this.errorCode = 0;
    this.errorCodeString = "n/a";

    // Clear out goal and pos set as these will get set on our next response from the motor
    this.goalPosition = null;
    this.jointPositionSetPoint = null;
   
    // Protocol: 0x01 0x06 

    // Create buffer for data
    const buff = Buffer.alloc(2)

    buff[0] = 0x01;
    buff[1] = 0x06; 

    // Create our output frame
    const out = {
      id: this.canId,
      data: buff
    };

    // Send frame
    this.channel.send(out); 
  
    // Wait 5 ms
    setTimeout(() => {
      this.stopped = false; // Re enable sending pos updates
      this.emit('reset');
    }, 5)
    
  }

  resetEnable() {
    this.reset();

    setTimeout(()=>{
      this.enable();
    },100);
  }

   /** ---------------------------------
   * queryPosition of the Motor
   * 
   * If the axis is not enabled the Position Cmd 0x14 can be used to query the current position and error code
   * 
   */
  queryPosition() {
      logger(`querying pos for motor with id ${this.id}`);

      // get pos in tics
      //const posInTics = this.gearScale * this.currentPosition;
      const posInTics = this.currentPosition / ( 360 / this.encoderTics );

      // Update the time stamp
      this.timeStamp = this.timeStamp === 255 ? 0 : this.timeStamp + 1;

      // Create buffer for data
      const buff = Buffer.alloc(8)

      // Set data 
      buff[0] = 0x14;                                           // First byte denominates the command, here: set joint position
      buff[1] = 0x00;                                           // Velocity, not used
      buff.writeIntBE(posInTics, 2, 4)                          // Write the position to the data 
      buff[6] = this.timeStamp;                                 // Time stamp
      buff[7] = 0;                                              // Digital out for this module, binary coded
    
      // Create our output frame
      const out = {
        id: this.canId,
        data: buff
      };

      // Send frame
      this.channel.send(out);
  }

  /** ---------------------------------
   * queryParameter of the Motor
   *  
   */
   queryParameter(index, subindex) {
      logger(`query parameter ${this.id} index ${index} subindex ${subindex}`);

      // Create buffer for data
      const buff = Buffer.alloc(3)

      // Set data 
      buff[0] = 0x96;                                           // First byte denominates the command, here: Read parameters 0x96
      buff[1] = index;                                          // Index
      buff[2] = subindex;                                       // SubIndex

      // Create our output frame
      const out = {
        id: this.canId,
        data: buff
      };

      // Send frame
      this.channel.send(out);
  }

  /** ---------------------------------
   * saveParameter of the Motor
   *
   */
   saveParameter(index, subindex, value) {
    logger(`save parameter ${this.id} index ${index} subindex ${subindex} value ${value}`);

    // Create buffer for data
    const buff = Buffer.alloc(7)

    // Set data
    buff[0] = 0x94;                                           // First byte denominates the command, here: Read parameters 0x96
    buff[1] = index;                                          // Index
    buff[2] = subindex;                                       // SubIndex
    buff.write(value, 3);
  
    // Create our output frame
    const out = {
      id: this.id,
      data: buff
    };

    // Send frame
    this.channel.send(out);
}

/** ---------------------------------
 * save Position Proportional constant of the Motor Position PID
 *
 */
savePositionPParameter(kP) {
  this.saveParameter(3,0,kP);
}

/** ---------------------------------
 * save Position Integral constant of the Motor Position PID
 *
 */
savePositionIParameter(kI) {
  this.saveParameter(3,1,kI);
}

/** ---------------------------------
 * save Position Derivative constant of the Motor Position PID
 *
 */
savePositionDParameter(kD) {
  this.saveParameter(3,2,kD);
}

/** ---------------------------------
 * save Position AntiWindup constant of the Motor Position PID
 *
 */
savePositionAntiWindupParameter(kAW) {
  this.saveParameter(3,3,kAW);
}

/** ---------------------------------
 * Will get the current joint state 
 * 
 * Usecase for this will be for a UI to poll this periodically and update for user to view
 */
get state(){
  return {
    id: this.id,
    canId: this.canId,
    ready: this.ready, 
    enabled: this.enabled,
    homing: this.homing,
    moving: this.moving,
    home: this.home,
    zeroed: this.zeroed,
    referenced: this.referenced,
    aligned: this.aligned,
    currentPosition: this.flip ? -this.currentPosition : this.currentPosition,
    currentTics: this.flip ? -this.currentTics : this.currentTics,
    encoderPulsePosition: this.flip ? -this.encoderPulsePosition : this.encoderPulsePosition,
    encoderPulseTics: this.flip ? -this.encoderPulseTics : this.encoderPulseTics,
    jointPositionSetPoint: this.flip ? -this.jointPositionSetPoint : this.jointPositionSetPoint,
    jointPositionSetTics: this.flip ? -this.jointPositionSetTics : this.jointPositionSetTics,
    goalPosition: this.flip ? -this.goalPosition : this.goalPosition,
    motorCurrent: this.motorCurrent,
		error: this.error,
    errorCode: this.errorCode,
    errorCodeString: this.errorCodeString ?? 'n/a',
    voltage: this.voltage,
    tempMotor: this.tempMotor,
    tempBoard: this.tempBoard,
    direction: this.backwards ? 'backwards' : 'forwards',
    motorError: this.motorError,
    adcError: this.adcError,
    rebelError: this.rebelError,
    controlError: this.controlError,
    parameters: this.parameters,
    timestamp: this.reportTimestamp,
    reportInterval: this.reportInterval,
    sendTimestamp: this.sendTimestamp,
    sendInterval: this.sendInterval,
    calculatedVelocity: Math.abs(this.calculatedVelocity),
    currentVelocity: this.currentVelocity / RATIO,
    encoderOffset: this.flip ? -this.encoderOffset : this.encoderOffset
  }
}

}

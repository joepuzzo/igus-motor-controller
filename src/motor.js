import {EventEmitter} from 'events';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:motor' + '\t');

// Error codes 
const codes = ['OC', 'DRV', 'ENC', 'LAG', 'COM', 'MNE', 'ESTOP', 'TEMP'];

// Parameter index mapping
const parameterMapping = ['board', 'motor', 'axis', 'control'];

// Parameter subindex mapping
const subindexMapping = {
  board: ['serialNo', 'firmwareversion', 'hardwareNo', 'minVoltage', 'maxTemp'],
  motor: ['encoderTics', 'poleParis', null, null, 'maxRpm', 'maxTemp', 'maxCurrent', 'startUpMethod', null, 'encoderInverted'],
  axis: [null, 'referenceType', 'referenceOffset', 'referenceSpeed', 'referenceSpeedSlow', 'referenceSwitchType', 'maxPos', 'breakType'],
}

// Helper
function dec2bin(dec) {
  // dec = 26 
  // decoded = '00011010'
  return (dec >>> 0).toString(2).padStart(8, '0');
}

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
  constructor({ id, canId, channel }) {

    logger(`creating motor ${id} with canId ${canId}`);

    // Becasuse we are event emitter
    super();

    // Define parameters
    this.id = id;                             // motor id
    this.canId = canId;                       // motor canId
    this.homing = false;                      // if motor is process of homing
    this.home = false;                        // if the motor is currently home
    this.enabled = false;                     // if motor is enabled
    this.cycleTime = 50;                      // in ms
    this.gearScale = 1031.11;                 // scale for iugs Rebel joint   
    this.encoderTics = 7424;					        // tics per revolution
    this.maxVelocity = 65;                    // degree / sec
    this.velocity = this.maxVelocity;         // Initial velocity is max
    this.currentVelocity = this.velocity;     // the current velocity ( will grow and shrink based on acceleration )       
    this.acceleration = 40;                   // The acceleration in degree / sec
    this.motionScale = 1;                     // Scales the motion velocity
    this.digitalOut = 0;                      // the wanted digital out channels
    this.digitalIn = 0;                       // the current digital int channels
    this.goalPosition = 0;                    // The joint goal position in degrees
    this.currentPosition  = 0;                // the current joint positions in degree, loaded from the robot arm
    this.currentTics = 0;                     // the current position in tics loaded from motor 
    this.jointPositionSetPoint = 0;           // The set point is a periodicly updated goal point 
    this.timeStamp = 0;                       // For message ordering 
    this.motorCurrent = 0;                    // Motor current in mA
    this.errorCode = 0;                       // the error state of the joint module
    this.errorCodeString;                     // human readable error code for the joint module
    this.stopped = true;                      // will disable position sends
    this.robotStopped = false;                // the motor might stop things but the robot might also have stop set
    this.gearZero = 0;                        // zero pos for gear
    this.encoderPulsePosition = null;         // the current joint position in degrees sent by the heartbeat from motor 
    this.encoderPulseTics = null;
    this.parameters = { board: {}, motor: {}, axis: {}, control: {} };             // A place to store any read parameters 

    // Our can channel
    this.channel = channel;

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
      const section = parameterMapping[index];
      const parameter = subindexMapping[section][subindex];
      this.parameters[section][parameter] = data;
    } else { 
      // err pos0 pos1 pos2 pos3 currentH currentL din 
      this.errorCode = buff[0];
      this.errorCodeString = this.decodeError(this.errorCode);
      const pos = buff.readIntBE(1, 4); // TODO might need this? .toString(10); 

      this.currentPosition = (pos - this.gearZero) / this.gearScale;
      //this.currentPosition = ( 360 / this.encoderTics ) * pos;
      this.currentTics = pos;
      this.motorCurrent = buff[6];
      this.digitalIn = buff[7]; // TODO split this down into its parts like we do with error

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
        logger(`Error`, buff[1], buff[2], buff[3], buff[4]);
        this.motorError = motorError;
        this.adcError = adcError;
        this.rebelError = rebelError;
        this.controlError = controlError;
      }
    } 

    if(buff[0] == 0xEF){

      // Position of the output drive in deg / 100
      let pos = buff.readIntBE(4, 4); // TODO might need this? .toString(10); 
      pos = pos * 10;

      const inDegrees = pos / this.gearScale; //( 360 / this.encoderTics) * pos;

      if( this.encoderPulsePosition == null ){
        // First time so initialize the current pos to this
        this.currentPosition = inDegrees;
				this.currentTics = pos;
        // Need to initialize the direction we will move to get to start goal ( 0 )
        this.backwards = this.goalPosition < this.currentPosition;
        //this.stopped = false;
      }
      
      // Now update this value every time
      this.encoderPulsePosition = inDegrees;
      this.encoderPulseTics = pos;
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
   * Will write out the pos values for joint 
   */
  writeJointSetPoints(){

    // If we are are stopped then dont send anything
    if(this.stopped || this.robotStopped){
      return;
    }

    // first we need to compute our position 

    // How far are we from our goal
    const distance = Math.abs(this.goalPosition - this.currentPosition);

    // If we are within two degrees just set set point to there
		if( distance < 2 ){
			this.jointPositionSetPoint = this.goalPosition;
      //logger(`Finished movement to ${this.currentPosition}`);
		} else if( this.enabled )  {

      // Basically we are increasing the goal degs by our movement segments
      //
      // note: we may have case where we are going from 45 to 40 where the dif is 40 - 45 ===> -5
      // in this case we want to go other direction
      const neg = this.goalPosition < this.currentPosition;

      // Determine if we are past the deccel point
      const past = neg ? this.currentPosition < this.deccelAt : this.currentPosition > this.deccelAt;

      // Here we either accel or deccel based on where we are
      if( this.deccelAt && past ){
        // Decellerate
        console.log('DECELERATING');
        this.currentVelocity = this.currentVelocity - ( this.acceleration / 20 );
      } else if( this.currentVelocity < this.velocity ){
        // Accelerate
        console.log('ACCELERATING');
        // We want to accelerate and decelerate the motor over the course of its delta to goal
        // acceleration is in °/s && there are 20 cycles in 1 second
        // therefore we break acceleration down by 20, increasing by 1/20th every cycle 
        this.currentVelocity = this.currentVelocity + ( this.acceleration / 20 );
      } else { 
        console.log('CRUSING');
        this.currentVelocity = this.velocity;
      }

      // vel ist in °/s so we need to break it down into our cycle segments
      // Example: (50 / 1000 ) * 45 = 2.25 deg per cycle
      const rate  = (this.cycleTime / 1000.0) * this.currentVelocity; 

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
  
    // Send that shit!
    this.channel.send(out)
  }

  /** ---------------------------------
   * Will set the position
   * 
   * @param {number} position - Position to go in degrees
   * @param {number} [velocity] - velocity in degrees / sec
   */
  setPosition( position, velocity, acceleration ) {
    logger(`Set Pos to ${position} velocity ${velocity} acceleration ${acceleration}`);
    this.velocity = velocity ?? this.velocity;
    this.acceleration = acceleration ?? this.acceleration;
    this.currentVelocity = this.velocity;
    this.goalPosition = position;
    this.backwards = this.goalPosition < this.currentPosition;

    // Based on set acceleration there is a point where we need to start to deccel calculate that point
    // 
    // Below we have distances A, B, and C
    // where A = C and are the ramp up and down times and B is the max speed time
    //
    // Total Distance = D
    //
    //  A         B         C
    //
    //      |          | 
    //      ____________
    //     /|          |\
    // ___/ |          | \___
    //
    //  T1       T2        T1
    //
    // Our goal is to calculate A + B to determine when to start C

    // First calculate the distance
    // Example1: D = 180 - 10 = 170
    // Example2: D = 20 - 10 = 10
    const D = Math.abs(this.goalPosition - this.currentPosition)

    // T1 is the time to get up to maxSpeed given at an acceleration.
    // Example: T1 = 65°s / 40°s = 1.625°s
    const T1 = this.velocity / this.acceleration;

    // Using displacement equation s=1/2 at^2 to get the distance traveled during T1
    // Example: A = .5 * 5°s * ( 13°s ** 2 ) = 52.8125
    const A = .5 * this.acceleration * (T1 ** 2);

    // B =  total distance - distance traveled to acclerate/decellerate
    // Example1: B = 170 - ( 2 * 52.8125 ) = 64.375 
    // Example2: B = 10 - ( 2 * 52.8125 ) = -95.625
    const B = D - (2 * A);

    // Now we know when to start deceleration
    // Note if B is negative then we simply split the distance in two half for deccel and half for accel
    const deccelAt = B < 0 ? D / 2 : A + B;

    // The deccelAt position is an offset from current pos
    this.deccelAt = this.backwards ? this.currentPosition - deccelAt : this.currentPosition + deccelAt; 

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

    // We are starting to home
    this.emit('zero');

    // Create buffer for data
    const buff = Buffer.alloc(4)

    buff[0] = 0x01;
    buff[1] = 0x08;
    buff[2] = 0x00;
    buff[3] = 0x00;

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
   * Will calibrate the motor ( for rotor orientation )
   */
  calibrate() {
    logger(`calibrating motor with id ${this.id}`);

    // We are starting to home
    this.emit('calibrating');

    // Create buffer for data
    const buff = Buffer.alloc(4)

    buff[0] = 0x01;
    buff[1] = 0x0C;
    buff[2] = 0x00;
    buff[3] = 0x00;

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
   * Enable the Motor
   * The Motor has to be in 0x04 or 00000100 = MNE Motor not enabled state.
   * This is the state after "reset"
   * 
   */
  enable() {

    logger(`enabling motor with id ${this.id} error code is currently ${dec2bin(this.errorCode)}`);

    if( dec2bin(this.errorCode)[5] != '1' ){
      const errorMessage = `Error: Please reset ${this.id} before enabling`
      logger(errorMessage);
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
    this.errorCode = 0;
    this.errorCodeString = "n/a";

    // First we set our set point to where we are ( in degrees )
    this.jointPositionSetPoint = this.currentPosition;
   
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
      const buff = Buffer.alloc(8)

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
    homing: this.homing,
    home: this.home,
    currentPosition: this.currentPosition,
    currentTics: this.currentTics,
    encoderPulsePosition: this.encoderPulsePosition,
    encoderPulseTics: this.encoderPulseTics,
    jointPositionSetPoint: this.jointPositionSetPoint,
    jointPositionSetTics: this.jointPositionSetTics,
    goalPosition: this.goalPosition,
    motorCurrent: this.motorCurrent,
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
    parameters: this.parameters
  }
}

}

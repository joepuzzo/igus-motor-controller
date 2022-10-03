import {EventEmitter} from 'events';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:motor' + '\t');

// Error codes 
const codes = ['OC', 'DRV', 'ENC', 'LAG', 'COM', 'MNE', 'ESTOP', 'TEMP'];

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
  constructor({ id, channel }) {

    logger(`creating motor with id ${id}`);

    // Becasuse we are event emitter
    super();

    // Define parameters
    this.id = id;
    this.cycleTime = 50;              // in ms
    this.gearScale = 1031.11;         // scale for iugs Rebel joint   
    this.maxVelocity = 45.0;          // degree / sec
    this.velocity = this.maxVelocity; // Initial velocity is max
    this.motionScale = 0.3;           // Scales the motion velocity
    this.digitalOut = 0;              // the wanted digital out channels
    this.digitalIn = 0;               // the current digital int channels
    this.goalPosition = 0;            // The joint goal position in degrees
    this.currentPosition  = 0;        // the current joint positions in degree, loaded from the robot arm
    this.jointPositionSetPoint = 0;   // The set point is a periodicly updated goal point 
    this.timeStamp = 0;               // For message ordering 
    this.motorCurrent = 0;            // Motor current in mA
    this.errorCode = 0;               // the error state of the joint module
    this.errorCodeString;             // human readable error code for the joint module
    this.stopped = true;              // will disable position sends
    this.robotStopped = false;        // the motor might stop things but the robot might also have stop set
    this.gearZero = 0;                // zero pos for gear

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

      if(msg.id === this.id + 1) {
        this.handleMotionMessage(msg) 
      }
      if(msg.id === this.id + 2) {
        this.handleProcessMessage(msg) 
      }
      if(msg.id === this.id + 3) {
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

    // err pos0 pos1 pos2 pos3 currentH currentL din 
    this.errorCode = buff[0];
    this.errorCodeString = this.decodeError(this.errorCode);
    const pos = buff.readUIntBE(1, 4); // TODO might need this? .toString(10); 

    this.currentPosition = (pos - this.gearZero) / this.gearScale;
    this.motorCurrent = buff[6];
    this.digitalIn = buff[7]; // TODO split this down into its parts like we do with error
     
  }

  /** ---------------------------------
   * Handles any process messages
   */
  handleProcessMessage(msg) {
    const buff = msg.data

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

    // write the setPoint command to the CAN bus
    // CPRCANV2 protocol:
    // 0x14 vel pos0 pos1 pos2 pos3 timer dout

    // first we need to compute our position

    // vel ist in °/s so we need to break it down into our cycle segments
    // Example: (50 / 1000 ) * 45 = 2.25 deg per tic
    const rate  = (this.cycleTime / 1000.0) * this.velocity; 

    // Our motor cant nessisarily move 2.25 deg per 50 ms so we need to scale it down
    // Example: 2.25 °/tic * 0.3 = 0.675 °/tic
    const movement = rate * this.motionScale; 

    // If we are not at our goal pos keep moving forward by the movement
    //
    // Example: goalPosition = 45  currentPosition = -45 
    // goalPosition - currentPosition = 45 - ( -45 ) = 90 ... i.e we still have 90 deg to move!
    // we use a tolerance because the world is not perfect
    const tolerance = 0.05;
    if( Math.abs(this.goalPosition - this.currentPosition) > tolerance ){ 
      // basically we are increasing the goal degs by our movement segments
      // 
      // note: we may have case where we are going from 45 to 40 where the dif is 40 - 45 ===> -5
      // in this case we want to go other direction
      const neg = this.goalPosition < this.currentPosition;
      this.jointPositionSetPoint = this.jointPositionSetPoint + ( neg ? -movement : movement);  // TODO maybe this should use this.currentPosition + movement ?? 
    }

    // generate the pos in encoder tics instead of degrees
    //const pos = Math.abs( (this.gearZero + this.jointPositionSetPoint) * this.gearScale); 
    const pos = 0;

    // Update the timestamp keeping it between 0-255 
    this.timeStamp = this.timeStamp === 255 ? 0 : this.timeStamp + 1;
    
    // Create buffer for data
    const buff = Buffer.alloc(8)

    console.log('POS', pos);

    // Set data 
    buff[0] = 0x14;                                           // First byte denominates the command, here: set joint position
    buff[1] = 0x00;                                           // Velocity, not used
    buff.writeUIntBE(pos, 2, 4)                               // Write the position to the data 
    buff[6] = this.timeStamp;                                 // Time stamp (not used)
    buff[7] = 0;                                              // Digital out for this module, binary coded
  
    //console.log(buff, 'pos:', pos)

    // Create our output frame
    const out = {
      id: this.id,
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
  setPosition( position, velocity ) {
    this.velocity = velocity ?? this.velocity;
    this.goalPosition = position;
  }

  /** ---------------------------------
   * Will home the motor by setting it to zero
   */
  home() {
    logger(`homing motor with id ${this.id}`);

    // We are starting to home
    this.emit('homing');

    // Create buffer for data
    const buff = Buffer.alloc(8)

    buff[0] = 0x01;
    buff[1] = 0x08;
    buff[2] = 0x00;
    buff[3] = 0x00;

    // Stop sending pos updates
    this.stopped = true;
    
    // Create our output frame
    const out = {
      id: this.id,
      data: buff
    };

    // Send first frame
    this.channel.send(out);

    // Wait 1 ms
    setTimeout(() => {
      this.channel.send(out); // Send second frame
      // Wait 5 ms
      setTimeout(() =>{
        //this.stopped = false; // Re enable sending pos updates
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
    const buff = Buffer.alloc(8)

    buff[0] = 0x01;
    buff[1] = 0x0C;
    buff[2] = 0x00;
    buff[3] = 0x00;

    // Stop sending pos updates
    this.stopped = true;
    
    // Create our output frame
    const out = {
      id: this.id,
      data: buff
    };

    // Send first frame
    this.channel.send(out);

    // Wait 1 ms
    setTimeout(() => {
      this.channel.send(out); // Send second frame
      // Wait 5 ms
      setTimeout(() =>{
        //this.stopped = false; // Re enable sending pos updates
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

    logger(`enabling motor with id ${this.id}`);

    if( !dec2bin(this.errorCode)[5] ){
      const errorMessage = `Error: Please reset ${id} before enabling`
      logger(errorMessage);
      this.emit('error', errorMessage);
    } else { 

      // Protocol: 0x01 0x09 to enable a joint
      //           0x01 0x0A to disable a joint

      // Create buffer for data
      const buff = Buffer.alloc(8)

      buff[0] = 0x01;
      buff[1] = 0x09;

      // Stop sending pos updates
      this.stopped = true; 

      // Create our output frame
      const out = {
        id: this.id,
        data: buff
      };

      // Send frame
      this.channel.send(out);
    
      // Wait 5 ms
      setTimeout(() => {
        //this.stopped = false; // Re enable sending pos updates
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
        id: this.id,
        data: buff
      };

      // Send frame
      this.channel.send(out);

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
   
    // Protocol: 0x01 0x06 

    // Create buffer for data
    const buff = Buffer.alloc(8)

    buff[0] = 0x01;
    buff[1] = 0x06;

    // Stop sending pos updates
    this.stopped = true; 

    // Create our output frame
    const out = {
      id: this.id,
      data: buff
    };

    // Send frame
    this.channel.send(out);
  
    // Wait 5 ms
    setTimeout(() => {
      //this.stopped = false; // Re enable sending pos updates
      this.emit('reset');
    }, 5)
    
  }


  /** ---------------------------------
   * Will get the current joint state 
   * 
   * Usecase for this will be for a UI to poll this periodically and update for user to view
   */
  get state(){
    return {
      id: this.id,
      currentPosition: this.currentPosition,
      jointPositionSetPoint: this.jointPositionSetPoint,
      goalPosition: this.goalPosition,
      motorCurrent: this.motorCurrent,
      errorCode: this.errorCode,
      errorCodeString: this.errorCodeString ?? 'n/a',
      voltage: this.voltage,
      tempMotor: this.tempMotor,
      tempBoard: this.tempBoard,
      motorError: this.motorError,
      adcError: this.adcError,
      rebelError: this.rebelError,
      controlError: this.controlError
    }
  }

}

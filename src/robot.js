
// import can from "socketcan";
import {EventEmitter} from 'events';
import { Motor } from './motor.js';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:robot' + '\t');

/**
 * Igus robot controller
 * 
 */
export class Robot extends EventEmitter   {

  /** -----------------------------------------------------------
   * Constructor
   */
  constructor({ id, motors }) {

    logger(`creating robot with id ${id}`, motors);

    // Becasuse we are event emitter
    super();

    // Create channel
    this.channel = { send: () => {} }; // can.createRawChannel('vcan0', true);

    // Create motors
    this.motorMap = {};
    this.motors = motors.map( (config, i) => {
      const motor = new Motor({ ...config, channel: this.channel })
      // Track by id
      this.motorMap[config.id] = motor;
      return motor;
    });

    // Define parameters
    this.id = id;
    this.uiFrequency = 1000;          // time in ms to update the ui
    this.cycleTime = 50;              // time in ms to push updates to motors
    this.stopped = false;             // will disable position sends
    this.ready = false;               // if robot is ready

    // Start up
    this.start();
  }

  /** ---------------------------------
   * 
   */
  start() {

    // Will write every 50ms ( frequency for controller)
    // setInterval(() => {
    //   this.writeJointSetPoints();
    // }, this.cycleTime);

    // Will push updates to ui 
    // setInterval(() => {
    //   this.emit('state', this.state);
    // }, this.uiFrequency);

    logger(`robot with id ${this.id} is ready`);
    this.ready = true;
    this.emit('ready');
  }

  /** ---------------------------------
   * Will write out the pos values for joint 
   */
  writeJointSetPoints(){

    // If we are are stopped then dont send anything
    if(this.stopped){
      return;
    }

    // Write out set points for all motors
    this.motors.forEach( motor => {
      motor.writeJointSetPoints();
    });
  }

  /** ---------------------------------
   * Will set the position of the specified motor
   * 
   * @param {number} position - Position to go in degrees
   * @param {number} [velocity] - velocity in degrees / sec
   */
  setMotorPosition(id, position, velocity){
    logger(`setMotorPos to ${position} for ${id}`);
    this.motorMap[id].setPosition(position, velocity)
  }

  /** ---------------------------------
   * Will reset the errors on specified motor
   * 
   * @param {*} id  
   */
  resetErrors(id){
    logger(`resetErrors for motor ${id}`);
    this.motorMap[id].reset()
  }

  /** ---------------------------------
   * Will enable the specified motor
   * 
   * @param {*} id  
   */
  enableMotor(id){
    logger(`enableMotor ${id}`);
    this.motorMap[id].enable()
  }

  /** ---------------------------------
   * Will home all the motors
   */
  home(){
    this.motors.forEach( motor => {
      motor.home();
    });
  }
  
  /** ---------------------------------
   * Will home a specific motor
   */
  homeMotor(id){
    logger(`homing motor ${id}`);
    this.motorMap[id].home()
  }

  /** ---------------------------------
   * Will get the current robot state 
   * 
   * Usecase for this will be for a UI to poll this periodically and update for user to view
   */
  get state(){
      // Build motors state object
      const motors = {};
      Object.values(this.motors).forEach( motor => {
        motors[motor.id] = motor.state;
      });
  
      // return state
      return {
        id: this.id,
        motors
      }
  }

  /** ---------------------------------
   * Will get the current robot metadata  
   */
  get meta(){
     // Build motors state object
     const motors = {};
     Object.values(this.motors).forEach( motor => {
       motors[motor.id] = { id: motor.id };
     });
 
     // return meta
     return {
       stopped: this.stopped, 
       ready: this.ready, 
       motors
     }
  }

}

import can from "socketcan";
import {EventEmitter} from 'events';
import { Motor } from './motor.js';

import five from "johnny-five";
import { mockBoard } from "./mockboard.js";

// For reading and writing to config
import path from 'path';
import fs from 'fs';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:robot' + '\t');

import NanoTimer from 'nanotimer';

const RATIO = 4.25;

/**
 * Igus robot controller
 * 
 */
export class Robot extends EventEmitter   {

  /** -----------------------------------------------------------
   * Constructor
   */
  constructor({ id, mock }) {

    logger(`creating robot with id ${id}`);

    // Becasuse we are event emitter
    super();

    // Create channel
    this.channel = can.createRawChannel('can1', true);

    // Define parameters
    this.id = id;
    this.uiFrequency = 1000;          // time in ms to update the ui
    this.cycleTime = 20;              // time in ms to push updates to motors
    this.stopped = false;             // will disable position sends
    this.ready = false;               // if robot is ready
    this.home = false;                // if the robot is currently home
    this.homing = false;              // if the robot is currently homing
    this.moving = false;              // if the robot is moving to a given position ( set angles was called )

    this.board = mock                 // Jhonny5 board
      ? mockBoard()
      : new five.Board({
        repl: false
    });

    // Start up the robot when board is ready
    this.board.on("ready", () => this.setup() );

  }

  /** ------------------------------
   * setup
   */
  setup() {

    // First read in the config 
    this.readConfig();
    
    // Create motors
    this.motorMap = {};

    // Each motor is tracked by a name 
    // 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x50
    this.motorMap.j0 = new Motor({id: 'j0', canId: 0x10, channel: this.channel, cycleTime: this.cycleTime, ...this.config.j0 });
    this.motorMap.j1 = new Motor({id: 'j1', canId: 0x20, channel: this.channel, cycleTime: this.cycleTime, ...this.config.j1 });
    this.motorMap.j2 = new Motor({id: 'j2', canId: 0x30, channel: this.channel, cycleTime: this.cycleTime, ...this.config.j2 });
    this.motorMap.j3 = new Motor({id: 'j3', canId: 0x40, channel: this.channel, cycleTime: this.cycleTime, ...this.config.j3 });
    this.motorMap.j4 = new Motor({id: 'j4', canId: 0x50, channel: this.channel, cycleTime: this.cycleTime, ...this.config.j4 });
    this.motorMap.j5 = new Motor({id: 'j5', canId: 0x60, channel: this.channel, cycleTime: this.cycleTime, ...this.config.j5 });

    // Array for iteration
    this.motors = Object.values(this.motorMap);

    // Subscribe to events for all motors
    this.motors.forEach(motor => {
      motor.on('homing', () => this.robotState() );
      motor.on('home', (id) => this.motorHomed(id) );
      motor.on('disabled', () => this.robotState() );
      motor.on('enabled', () => this.robotState() );
      motor.on('reset', () => this.robotState() );
      motor.on('moved', (id) => this.motorMoved(id) );
      motor.on('pulse', (id, pos) => this.motorPulse(id, pos))
    });

     // Create Gripper
     this.gripper = new five.Servo({
      pin: 10,
      startAt: 20
     });

    // Start robot
    this.start();
   }

  /** ---------------------------------
   * Starts up the robot
   */
  start() {

    // Will write every 50ms ( frequency for controller)
    //setInterval(() => {
    //  this.writeJointSetPoints();
    //}, this.cycleTime);
 
		const timer = new NanoTimer();

		timer.setInterval(()=>{
    	this.writeJointSetPoints();
		}, '', `${this.cycleTime}m`);

    // Will push updates to ui 
    setInterval(() => {
      this.emit('state', this.state);
    }, this.uiFrequency);

    // Report all encoder updates at 100ms interval
    setInterval(()=>{
    	this.emit('encoder');
    }, 500);

    logger(`robot with id ${this.id} is ready`);
    this.ready = true;
    this.emit('ready');
    this.channel.start();
  }

  /** ---------------------------------
   * Will trigger a robot state update 
   */
  robotState(){
    this.emit('state');
  }

  /** ---------------------------------
   * Will take any actions needed when a motor is done moving
   */
  motorMoved(id) {
    logger(`motor ${id} moved`);

    // If we are moving robot to a position check if its done
    if(this.moving){
      if(this.motors.every( motor => !motor.moving)){
        logger(`all motors have moved!`);
        this.moving = false;
        this.emit("moved");
      }
    }

    this.emit("meta");
    this.emit('state');
  }

  /** ---------------------------------
   * Will evaluate if the whole robot is home 
   */
  motorHomed(id){
    logger(`motor ${id} is homed`);

    // If we are homing robot check to see if we are all done homing
    if(this.homing && this.motors.every( motor => motor.home)){
      logger(`all motors are home!`);
      this.home = true 
      this.homing = false;
    }

    this.emit('meta');
    this.emit('state');
  }

  motorPulse(id, pos){
    this.emit('pulse', id, pos);
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

  /* -------------------- Motor Actions -------------------- */

  motorSetPosition(id, position, velocity){
    logger(`set position to ${position} for motor ${id} velocity ${velocity}`);
    this.motorMap[id].setPosition(position, velocity)
  }

  motorHome(id){
    logger(`homing motor ${id}`);
    this.motorMap[id].goHome()
  }

  motorResetErrors(id){
    logger(`resetErrors for motor ${id}`);
    this.motorMap[id].reset()
  }

  motorEnable(id){
    logger(`enable motor ${id}`);
    this.motorMap[id].enable()
  }

  motorDisable(id){
    logger(`disableMotor ${id}`);
    this.motorMap[id].disable()
  }

  motorZero(id){
    logger(`zero motor ${id}`);
    this.motorMap[id].zero();
  }

  motorCalibrate(id){
    logger(`calibrateMotor ${id}`);
    this.motorMap[id].calibrate();
  }

  motorReference(id){
    logger(`referenceMotor ${id}`);
    this.motorMap[id].reference();
  }

  queryMotorPosition(id){
    logger(`queryMotorPosition ${id}`);
    this.motorMap[id].queryPosition();
  }

  queryMotorParamter(id, index, subindex){
    logger(`queryMotorParamter ${id} index ${index} subindex ${subindex}`);
    this.motorMap[id].queryParameter(index, subindex);
  }

  /* -------------------- Robot Actions -------------------- */

  robotHome(){
    logger(`home robot`);

    // Update our state
    this.homing = true;
    this.moving = true;
    
    this.motors.forEach( motor => {
      motor.goHome();
    });
  }

  robotStop(){
    logger(`stop robot`);

    //this.stopped = true;

    // Disable all motors
    this.motors.forEach(motor => {
      motor.disable();
    });     

    this.emit("meta");
  }

  robotFreeze(){
    logger(`robotFreeze robot`);

    this.stopped = true;
    this.moving = false;

    // Disable all motors
    this.motors.forEach(motor => {
      motor.disable();
    });     

    this.emit("meta");
  }

  robotCenter(){
    logger(`center robot`);

    // We are moving whole robot
    this.moving = true;

    // Centers all motors
    this.motors.forEach(motor => {
      motor.goHome();
    });     

    this.emit("meta");
  }

  robotReference(){
    logger(`reference robot`);

    // Zero out all motors
    this.motors.forEach((motor, i) => {
      setTimeout(()=>{
        motor.reference();
        this.emit("meta");
      }, 1000 * i)
    });     

  }

  robotZero(){
    logger(`zero robot`);

    // Zero out all motors
    this.motors.forEach((motor, i) => {
      setTimeout(()=>{
        motor.zero();
        this.emit("meta");
      }, 1000 * i)
    });     

  }

  robotReset(){
    logger(`reset robot`);

    this.stopped = false;

    // Enable all motors
    this.motors.forEach((motor, i) => {
      setTimeout(()=>{
        motor.reset();
        this.emit("meta");
      }, 1000 * i)
    });     

  }

  robotEnable(){
    logger(`enable robot`);

    this.stopped = false;

    // Enable all motors
    this.motors.slice().reverse().forEach((motor, i) => {
      setTimeout(()=>{
        motor.enable();
        this.emit("meta");
      }, 3000 * i)
    });     

  }

  robotSetAngles(angles, speed){
    logger(`robotSetAngles at speed ${speed} angles:`, angles);

    // We are moving whole robot
    this.moving = true;

    // If we want all movements to end at the same time
    this.moveMotorsAtSameTime(angles, speed);

    // Set each motor angle
    // this.motors.forEach( (motor, i) => {
    //   motor.setPosition(angles[i], speed);
    // });
  }

  robotAccelEnabled(value){
    logger(`robotAccelEnabled to ${value}`);
    // Turn on accel for all motors
    this.motors.forEach( (motor, i) => {
    	this.updateConfig(`${motor.id}.accelEnabled`, value)
    });
  }

  moveMotorsAtSameTime(angles, speed){

      // Step1: First find the motor that will take the longest time
      let longestTime = 0;
      let longestMotor = this.motors[0];
      let longestMotorTimeAtSpeed = 1;
      let longestRatio = 0;
	    let results = [];

      this.motors.forEach((motor, i)=>{

        // We want to determine the speed ( dont allow user to go over motor max speed )
        let maxSpeed = speed && ( speed <= motor.maxVelocity ) ? speed : motor.maxVelocity;

				maxSpeed = maxSpeed / RATIO;

				// Determine goal point
        let goal = angles[i];
    		if( motor.flip ) {
     			goal = -goal;
      		goal = goal - motor.offset;
    		} else {
      		goal = goal + motor.offset;
    		}
       
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
        // Our goal is to calculate T1 and T2

        // First calculate the distance
        // Example1: D = 90 - 0 = 90
        // Example2: D = 20 - 10 = 10
        const D = Math.abs(goal - motor.currentPosition)

        // T1 is the time to get up to maxSpeed given at an acceleration.
        // Example: T1 = 65°s / 40°s = 1.625°s
        const T1 = maxSpeed / motor.maxAccel * motor.motionScale;

        // Using displacement equation s=1/2 at^2 to get the distance traveled during T1
        // Example: A = .5 * 40°s * ( 1.625°s ** 2 ) = 52.8125
        const A = .5 * motor.maxAccel * (T1 ** 2)  * motor.motionScale;

        // B =  total distance - distance traveled to acclerate/decellerate
        // Example1: B = 90 - ( 2 * 52.8125 ) = -15.625 
        // Example2: B = 10 - ( 2 * 52.8125 ) = -95.625
        let B = D - (2 * A);

 				// Note if B is negative then we simply split the distance in two half for deccel and half for accel
    		// B = B < 0 ? 0 : B;

        // Time to travel distance B (while at max speed) is B/maxSpeed
        const T2 = B > 0 ? B / maxSpeed : 0;

        // Set total time
        const thisTime = T1 + T2 + T1;

        // Add to results
        results.push({ accelDistance: A, cruiseDistance: B, distance: D, accelTime: T1, cruiseTime: T2, A, B, D, T1, T2 })

        // Update longest if its longer
        if(thisTime > longestTime){
          longestTime = thisTime;
          longestMotor = motor;
          longestMotorTimeAtSpeed =  T2;
          longestRatio = B / D;
        }

      });

      logger(`Longest time is ${longestTime} for motor ${longestMotor.id}`);
      logger(`Results`, results);

      // Step2: Move via speed for each based on time
      this.motors.forEach((motor, i) => {

        // Scale down the speed based on longest time
        const { D } = results[i];

        // We want this motor to spend longestMotorTimeAtSpeed at speed
        // It will travel D * longestMotorTimeAtSpeed/longestTime total distance at speed
        // How fast will it need to go to cover this distance?
        const ratio = longestRatio;
        const distanceAtSpeed = D * ratio;
        logger(`Ratio, ${ratio}, distanceAtSpeed: ${distanceAtSpeed}`);
        let travelSpeed = distanceAtSpeed / longestMotorTimeAtSpeed;

        // This leaves (longestTime - longestMotorTimeAtSpeed) many seconds for accel and decel
        // What acceleration is required to reach travelSpeed in (longestTime - longestMotorTimeAtSpeed)/2 seconds?
        const timeForAcceleration = (longestTime - longestMotorTimeAtSpeed) /2;
        const acceleration = travelSpeed / timeForAcceleration * motor.motionScale;

				// TEMP FOR RATIO ISSUE 
				travelSpeed = Math.round(travelSpeed * RATIO);
        
        if( travelSpeed <= motor.maxVelocity + 1 && acceleration <= motor.maxAccel + 1 ){
          // Now go! ( make sure we pass degrees and not steps to this func )
          logger(`About to set motor ${motor.id} to ${angles[i]} at a speed of ${travelSpeed} and acceleration of ${acceleration}`);
          motor.setPosition(angles[i], travelSpeed, acceleration);
        } else {
          logger(`ERROR!! unable to set pos for motor ${motor.id} with acceleration ${acceleration} and speed ${travelSpeed} as one of them is too big!`)
        }
      })

  }

  /** ---------------------------------
   * Will get the current robot state 
   * 
   * use-case for this will be for a UI to poll this periodically and update for user to view
   */
  get state(){
      // Build motors state object
      const motors = {};
      this.motors.forEach( motor => {
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
     this.motors.forEach( motor => {
       motors[motor.id] = { id: motor.id };
     });
 
     // return meta
     return {
       stopped: this.stopped, 
       ready: this.ready, 
       home: this.home,
       homing: this.homing,
       moving: this.moving,
       motors
     }
  }

 /* -------------------- Gripper Actions -------------------- */

  gripperSetPosition(pos, speed = 500){
    logger(`set position for gripper to ${pos}, at speed ${speed}`);
    this.gripper.to(pos,speed);
    setTimeout(()=>{
        this.emit("moved");
    }, 1000)
  }


 /* -------------------- Config Actions -------------------- */

  /** ------------------------------
   * readConfig
   */
  readConfig() {
    // Read in config file ( create if it does not exist yet )
    try {
      // Get filename
      const filename = path.resolve('config.json');

      // Check if it exists and create if it does not
      if (!fs.existsSync(filename)) {
        console.log('Config file does not exist creating');
        fs.writeFileSync(filename, JSON.stringify({}));
      }

      // Read in config file
      const config = JSON.parse(fs.readFileSync(filename, 'utf8'));

      logger('Successfully read in config', config);

      this.config = config;
    } catch (err) {
      console.error(err);
    }
  }
  
  /** ------------------------------
   * writeConfig
   */
  writeConfig() {
    logger('Writing config to file', this.config);
    try {
      // Get filename
      const filename = path.resolve('config.json');
      // Write config
      fs.writeFileSync(filename, JSON.stringify(this.config));
    } catch (err) {
      console.error(err);
    }
  }

  /** ------------------------------
   * updateConfig
   *
   * By default this will NOT save to the file it will only update in memory
   * Note: a call to writeConfig() at any time will save everything that has been updated to the file
   */
  updateConfig(key, value, save = false) {
    logger(`updating config ${key} to ${value}`);

    // Special check ( dont let user set a config param to null !! )
    if (value == null) {
      logger(`Unable to set ${key} to ${value} as its null`);
      return;
    }

    // Example key = "j0.limitAdj"
    if (key.includes('.')) {
      const [joint, param] = key.split('.');

      logger(`updating ${joint}'s ${param} to ${value}`, this.config[joint])

      // Update the config
      this.config[joint][param] = value;

      // Update the motor
      this.motorMap[joint][param] = value;
    } else {
      this.config[key] = value;
    }

    // Now write the config out
    if (save) this.writeConfig();

    logger(`updated config`, this.config);

    this.emit('meta');
  }

}

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:robot' + '\t');

// For rounding
const r = v => Math.round(v * 100) / 100; 

// Below is for testing purposes TODO write tests
// 
//const motors = [
//  { id: 'j0', currentPosition: 0, flip: true, maxVelocity: 27, maxAccel: 30, offset: 0 },
//  { id: 'j1', currentPosition: -30, flip: true, maxVelocity: 27, maxAccel: 30, offset: 30 },
//  { id: 'j2', currentPosition: -30, flip: true, maxVelocity: 27, maxAccel: 30, offset: 30 },
//  { id: 'j3', currentPosition: 0, flip: true, maxVelocity: 27, maxAccel: 30, offset: 0 },
//  { id: 'j4', currentPosition: 8, flip: true, maxVelocity: 27, maxAccel: 30, offset: -8 },
//  { id: 'j5', currentPosition: -14, flip: true, maxVelocity: 27, maxAccel: 30, offset: 14 },
//];
//
//const angles = [
//  17.354024636261325,
//  13.313356577068296,
//  -90.20268335754047,
//  -54.025338238520575,
//  -21.62744121257538,
//  52.01598310148049
//]

const getGoalPositon = (motor, position) => {
  if( motor.flip ) {
    return -position - motor.offset;
  } 
  return position + motor.offset;
}

// Below we have distances A and B and times T1 and T2
// 
// A = the ramp up and down distances 
// B = the distance at max speed
// 
// T1 = the ramp up and down time 
// T2 = the time at max speed
//
// D = Total Distance
//
// TIME   = total time
// DECCEL = position where we are going to start decelleration
//
//  A         B         A
//
//      |          | 
//      ____________
//     /|          |\
// ___/ |          | \___
//
//  T1       T2        T1
//  
//               DECCEL
//
export const getMotion = (motor, angle, speed, acceleration) => {

    const maxSpeed = speed ?? motor.maxVelocity;
    const maxAccel = acceleration ?? motor.maxAccel;

    // Calculate the total distance traveled D
    // Example1: D = 90 - 0 = 90
    // Example2: D = 20 - 10 = 10
    const goal = getGoalPositon(motor, angle);
    const D = Math.abs(goal - motor.currentPosition);

    // T1 is the time to get up to maxSpeed given at an acceleration.
    // Example: T1 = 65°s / 40°s = 1.625°s
    const T1 = maxSpeed / maxAccel;

    // Using displacement equation s=1/2 at^2 to get the distance traveled during T1
    // Example: A = .5 * 40°s * ( 1.625°s ** 2 ) = 52.8125
    const A = .5 * maxAccel * (T1 ** 2);

    // B = total distance - distance traveled to accelerate / decelerate
    // Example1: B = 90 - ( 2 * 52.8125 ) = -15.625 
    // Example2: B = 10 - ( 2 * 52.8125 ) = -95.625
    let B = D - (2 * A);

    // Time to travel distance B (while at max speed) is B / maxSpeed
    // Note, if B is negative then T2 is zero as we are not traveling any distance at max speed ( never got up to speed )
    const T2 = B > 0 ? B / maxSpeed : 0;

    // Set total time
    const TIME = T1 + T2 + T1;

    // Determine where to start decceleration
    // Note if B is negative then we simply split the distance in two half for deccel and half for accel
    const DECCEL = B < 0 ? D / 2 : A + B;

    const MESSAGE = `Motor ${motor.id} to ${r(angle)} at a speed of ${r(speed)} over distance of ${r(B)} for ${r(T2)} seconds and acceleration of ${r(acceleration)} over distance of ${r(A)} for ${r(T1)} seconds`;

    return { A, B, T1, T2, D, TIME, DECCEL, MESSAGE };
}


export const generateMotionCommands = (motors, angles, speed, acceleration) => {

    // -----------------------------------------------------------
    // Step1: First find the motor that will take the longest time

    let longest = {
      time: 0,            // Longest motor movement time
      motor: motors[0],   // Motor that will take the longest
      timeAtSpeed: 1,     // Longest 
      ratio: 0            // The ratio of the max speed distance relative to the total distance traveled
    }
    const results = []

    // Iterate over each motor to determine longest
    motors.forEach((motor, i) => {

      const motion = getMotion(motor, angles[i], speed, acceleration);
      
      // Add to results
      results.push(motion)

      const { TIME, T2, B, D } = motion;

      // Update longest if its longer
      if(TIME > longest.time){
        longest = {
          time: TIME,
          motor,
          timeAtSpeed: T2,
          ratio: B / D
        };
      }
    });

    logger(`Longest time is ${r(longest.time)} for motor ${longest.motor.id}`);

    // -----------------------------------------------------------
    // Step2: Now that we know the longest time we can use what we learned to create the motion commands
    const commands = []; 
		let success = true;

    motors.forEach((motor, i) => {

      // Scale down the speed based on longest time
      const { D, A, B, T1, T2 } = results[i];
  
      // We want this motor to spend the same amount of time at speed as the motor that takes the longest time
      // It will travel D * longest.timeAtSpeed / longestTime total distance at speed
      // So we determine what to set the speed to in order to go to cover this distance in that time
      const distanceAtSpeed = D * longest.ratio;
      const travelSpeed = distanceAtSpeed / longest.timeAtSpeed;
  
      // This leaves (longestTime - longestMotorTimeAtSpeed) many seconds for accel and decel
      // What acceleration is required to reach travelSpeed in (longestTime - longestMotorTimeAtSpeed)/2 seconds?
      const accelTime = ( longest.time - longest.timeAtSpeed ) /2;
      const acceleration = travelSpeed / accelTime;
      
      if( travelSpeed <= motor.maxVelocity + 1 && acceleration <= motor.maxAccel + 1 ){
        logger(`Motor ${motor.id} to ${r(angles[i])} at a speed of ${r(travelSpeed)} over distance of ${r(B)} for ${r(T2)} seconds and acceleration of ${r(acceleration)} over distance of ${r(A)} for ${r(T1)} seconds`);
       	commands.push({ id: motor.id, angle: angles[i], velocity: travelSpeed, acceleration }); 
      } else {
        success = false;
        logger(`ERROR!! unable to set pos for motor ${motor.id} with acceleration ${acceleration} and speed ${travelSpeed} as one of them is too big!`)
      }
    });

		return { commands, success };
}

//console.log(generateMotionCommands(motors, angles));

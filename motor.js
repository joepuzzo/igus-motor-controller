
import can from "socketcan";

export class Motor  {

  /** -----------------------------------------------------------
   * Constructor
   */
  constructor(id) {

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

    // Create channel
    this.channel = can.createRawChannel('vcan0', true);

    // Start up
    this.start();
  }

  /** ---------------------------------
   * Will write every 50ms ( frequency for controller)
   */
  start() {
    setInterval(() => {
      this.writeJointSetPoints();
    }, this.cycleTime);
  }

  /** ---------------------------------
   * Will set the goal position
   * 
   * @param {*} position - Position to go in degrees
   * @param {*} velocity - velocity in degrees / sec
   */
  setGoalPosition( position, velocity ) {
    this.velocity = velocity;
    this.goalPosition = position;
  }

  /** ---------------------------------
   * Will write out the pos values for joint
   * 
   * @param {*} jointSetPoint -  Position to go in degree 
   * @param {*} digitalOut - State of the digital outputs (if there are any) of the module, coded binary
   * @param {*} jointCurrent - Current position of the joint in degree
   * @param {*} motorCurrent - Motor current in mA
   * 
   */
  writeJointSetPoints(){

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
      this.jointPositionSetPoint = this.jointPositionSetPoint + movement;    
    }

    // generate the pos in encoder tics instead of degrees
    const pos = this.jointPositionSetPoint * this.gearScale; 
    
    // Create buffer for data
    const buff = Buffer.alloc(8)
  
    // Set data 
    buff[0] = 0x14;                                           // First byte denominates the command, here: set joint position
    buff[1] = 0x00;                                           // Velocity, not used
    buff.writeUIntBE(pos, 2, 4)                               // Write the position to the data 
    buff[6] = timeStamp;                                      // Time stamp (not used)
    buff[7] = digitalOut;                                     // Digital out for this module, binary coded
  
    console.log(buff, 'revs:', revs, ' speed:', speed)

    // Create our output frame
    const out = {
      id: this.id,
      data: buff
    };
  
    // Send that shit!
    this.channel.send(out)
  }

}
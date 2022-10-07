import io from 'socket.io-client';
import { Robot } from './robot.js';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:server' + '\t');

export const startServer = (config) => {

  // Create socket
  const connectionString = `http://${config.host}:${config.port}/robot?id=${config.id}`;
  const socket = io(connectionString);
  logger("created socket", connectionString);

  // Define motor configs from config
  const motors = config.ids.map( m => ({ id: m }) );

  // Create robot
  const robot = new Robot({ id: config.id, motors });

  /* ---------- Subscribe to robot events ---------- */
  robot.on('state', () => {
    logger("sending state");
    socket.emit('state', robot.state );
  });

  robot.on('encoder', () => {
    // Specifically dont log here ( to much logging )
    socket.emit('encoder', robot.state );
  });

  robot.on('ready', () => {
    logger("robot ready sending state and registering");
    socket.emit('register', robot.meta);
    socket.emit('state', robot.state );  
  });

  robot.on('meta', () => {
    logger("sending meta");
    socket.emit("register", robot.meta);
  });

  robot.on('moved', () => {
    logger("sending moved");
    socket.emit("moved", robot.meta);
  });


  /* ---------- Subscribe to socket events ---------- */

  socket.on('connect', ()=>{
    logger("robot is connected to controller, sending state");
    socket.emit('register', robot.meta);
    socket.emit('state', robot.state );
  });

  socket.on('hello', msg => {
    logger("controller says hello");
  });

  socket.on('motorSetPos', (id, pos) => {
    logger(`controller says setMotorPos to ${pos} for motor ${id}`);
    robot.motorSetPosition(id, pos);
  });

  socket.on('motorResetErrors', (id) => {
    logger(`controller says resetErrors for motor ${id}`);
    robot.motorResetErrors(id);
  });

  socket.on('motorEnable', (id) => {
    logger(`controller says enableMotor ${id}`);
    robot.motorEnable(id);
  });

  socket.on('motorDisable', (id) => {
    logger(`controller says disableMotor ${id}`);
    robot.motorDisable(id);
  });

  socket.on('motorCalibrate', (id) => {
    logger(`controller says calibrateMotor ${id}`);
    robot.motorCalibrate(id);
  });

  socket.on('queryMotorPosition', (id) => {
    logger(`controller says queryMotorPosition ${id}`);
    robot.queryMotorPosition(id);
  });

  socket.on('queryMotorParameter', (id, index, subindex) => {
    logger(`controller says queryMotorParameter for motor ${id} index ${index} subindex ${subindex}`);
    robot.queryMotorParamter(id, index, subindex);
  });

  socket.on('motorHome', (id) => {
    logger(`controller says motorHome ${id}`);
    robot.motorHome(id);
  });

  socket.on('motorZero', (id) => {
    logger(`controller says motorZero ${id}`);
    robot.motorZero(id);
  });

  socket.on('robotHome', () => {
    logger(`controller says home robot`);
    robot.robotHome();
  });

  socket.on('robotStop', () => {
    logger(`controller says robotStop`);
    robot.robotStop();
  });

  socket.on('robotEnable', () => {
    logger(`controller says robotEnable`);
    robot.robotEnable();
  });

  socket.on('robotCenter', () => {
    logger(`controller says robotCenter`);
    robot.robotCenter();
  });

  socket.on('disconnect', () => {
    logger("robot is disconnected from controller");
  });

}

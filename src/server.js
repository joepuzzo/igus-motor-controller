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
  robot.on('ready', () => {
    logger("robot is ready sending state", robot.state);
    socket.emit('state', robot.state );
  });

  robot.on('homing', () => {
    logger("robot is homing sending state", robot.state);
    socket.emit('state', robot.state );
  });

  robot.on('home', () => {
    logger("robot is home sending state", robot.state);
    socket.emit('state', robot.state );
  });

  robot.on('state', () => {
    logger("sending state", robot.state);
    socket.emit('state', robot.state );
  });


  /* ---------- Subscribe to socket events ---------- */

  socket.on('connect', ()=>{
    logger("robot is connected to controller, sending state", robot.state);
    socket.emit('state', robot.state );
  });

  socket.on('hello', msg => {
    logger("controller says hello");
  });

  socket.on('setMotorPos', (id, pos) => {
    logger(`controller says setMotorPos to ${pos} for ${id}`);
    robot.setMotorPosition(id, pos);
  });

  socket.on('home', () => {
    logger(`controller says home robot`);
    robot.home();
  });

  socket.on('disconnect', () => {
    logger("robot is disconnected from controller");
  });

}
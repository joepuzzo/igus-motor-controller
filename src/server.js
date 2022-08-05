import io from 'socket.io-client';
import { Motor } from './motor.js';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:server' + '\t');

export const startServer = (config) => {

  // Create socket
  const connectionString = `http://${config.host}:${config.port}/motor?id=${config.id}`;
  const socket = io(connectionString);
  logger("created socket", connectionString);

  // Create motor
  const motor = new Motor({ id: config.id });

  /* ---------- Subscribe to motor events ---------- */
  motor.on('ready', () => {
    logger("motor is ready sending state", motor.state);
    socket.emit('state', motor.state );
  });

  motor.on('homing', () => {
    logger("motor is homing sending state", motor.state);
    socket.emit('state', motor.state );
  });

  motor.on('home', () => {
    logger("motor is home sending state", motor.state);
    socket.emit('state', motor.state );
  });


  /* ---------- Subscribe to socket events ---------- */

  socket.on('connect', ()=>{
    logger("motor is connected to controller, sending state", motor.state);
    socket.emit('state', motor.state );
  });

  socket.on('hello', msg => {
    logger("controller says hello");
  });

  socket.on('setPos', (pos) => {
    logger(`controller says setPos to ${pos}`);
    motor.setPosition(pos);
  });

  socket.on('home', () => {
    logger(`controller says home motor`);
    motor.home();
  });

  socket.on('disconnect', () => {
    logger("motor is disconnected from controller");
  });

}
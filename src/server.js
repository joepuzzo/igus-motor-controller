import io from 'socket.io-client';
import { Motor } from './motor';

// For debugging
import { Debug } from './debug';
const logger = Debug('igus:server' + '\t');

module.exports = (config) => {

  // Create socket
  const socket = io(`http://${config.host}:${config.port}/motor?id=${config.id}`);
  logger("created socket");

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
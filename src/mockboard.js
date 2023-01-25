import mocks from "mock-firmata";
import five from "johnny-five";

export const mockBoard = (pins) => {

  if (pins) {
    pins.forEach(function(pin) {
      Object.assign(pin, {
        mode: 1,
        value: 0,
        report: 1,
        analogChannel: 127
      });
    });
  }

  // Need this so we can simulate stepper callback
  mocks.Firmata.prototype.accelStepperConfig = ()=>{};
  mocks.Firmata.prototype.accelStepperEnable = ()=>{};
  mocks.Firmata.prototype.accelStepperSpeed = ()=>{};
  mocks.Firmata.prototype.accelStepperStep = (a,b,func)=>{func()};
  mocks.Firmata.prototype.accelStepperTo = (a,b,func)=>{func()};

  const io = new mocks.Firmata({
    pins: pins
  });

  io.SERIAL_PORT_IDs.DEFAULT = 0x08;

  io.emit("connect");
  io.emit("ready");

	const board = new five.Board({
    io: io,
    debug: false,
    repl: false
  });

  return board;
}

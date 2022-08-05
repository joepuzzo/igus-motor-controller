import can from "socketcan";

const channel = can.createRawChannel('vcan0', true);

setInterval(() => {

  const out = {}

  // write the setPoint command to the CAN bus
  // CPRCANV2 protocol:
  // 0x14 vel pos0 pos1 pos2 pos3 timer dout
  const tmpPos = gearZero + jointSetPoint * gearScale;      // generate the setPoint in encoder tics

  out.ID = messageID;                                       // the CAN ID of the joint

  // Create buffer for data
  const buff = Buffer.alloc(8)

  // Set data 
  buff[0] = 0x14;                                           // first byte denominates the command, here: set joint position
  buff[1] = 0x00;                                           // velocity, not used
  buff.writeUIntBE(tmpPos, 2, 4)                            // SetPoint Position, 
  buff[6] = timeStamp;                                      // Time stamp (not used)
  buff[7] = digitalOut;                                     // Digital our for this module, binary coded

  console.log(buff, 'revs:', revs, ' speed:', speed)

  out.id = msg.id
  out.data = buff

  channel.send(out)

}, 50)

channel.start()
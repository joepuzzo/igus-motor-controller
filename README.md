# Getting Started 

First you need to make sure you have a can adapter ( USB or CAN hat ) whatever can interface you use you need to bring that interface up.

```bash
sudo ip link set can1 up type can bitrate 500000 berr-reporting on
```

Next you need to start up the motor controller, you do this with the following command

```bash
DEBUG='igus:.*' node index.js -p 3000 --host 192.168.0.107
```

Note the command line parameters, all parameters can be seen in this table: 

| Parameter        | Example                | Optional | Default | Description                                       |
| ---------------- | ---------------------- | -------- | ------- | ------------------------------------------------- |
| `--host`         | `--host 192.168.0.107` | NO       |         | Host ( robot viewer ) ip address                  |
| `-p` OR `--port` | `-p 3000`              | Yes      | 80      | Host ( robot viewer ) port                        |
| `--mock`         | `--mock`               | Yes      | false   | If you dont have arduino connected mock the board |
| `--can`          | `--can can1`           | Yes      | can1    | The can interface                                 |

Please Note: if you are not using any sort of extra IO / Gripper then pass --mock so it does not attempt to connect to an arduino.

## Config 

The presense of a config.json will result in motor parameters changing. 

Example ( IGUS ): 

```json
{
  "j0": { "limNeg": -180, "limPos": 180, "flip": true, "gearRatio": 70 },
  "j1": { "limNeg": -140, "limPos": 80, "offset": 30, "flip": true, "gearRatio": 70 },
  "j2": { "limNeg": -140, "limPos": 80, "offset": 30, "flip": true, "gearRatio": 70 },
  "j3": { "limNeg": -180, "limPos": 180, "flip": true, "gearRatio": 70 },
  "j4": { "limNeg": -95, "limPos": 95, "offset": -8, "flip": true, "gearRatio": 50 },
  "j5": { "limNeg": -180, "limPos": 180, "offset": 14, "flip": true, "gearRatio": 50 }
}
```

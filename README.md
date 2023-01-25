# Getting Started 

```bash
sudo ip link set can1 up type can bitrate 500000 berr-reporting on
```

```bash
DEBUG='igus:.*' node index.js -p 3000 --host 192.168.0.107
```

## Config 

The presense of a config.json will result in motor parameters changing. 

Example ( IGUS ): 

```json
{
  "j0": { "limNeg": -180, "limPos": 180, "flip": true },
  "j1": { "limNeg": -140, "limPos": 80, "offset": 30, "flip": true },
  "j2": { "limNeg": -140, "limPos": 80, "offset": 0, "flip": true },
  "j3": { "limNeg": -180, "limPos": 180, "flip": true },
  "j4": { "limNeg": -95, "limPos": 95, "offset": -8, "flip": true },
  "j5": { "limNeg": -180, "limPos": 180, "offset": 14, "flip": true }
}
```
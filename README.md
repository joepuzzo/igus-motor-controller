# Getting Started 

```bas
DEBUG='igus:.*' node index.js -p 3000 --host 192.168.0.107
```

## Config 

The presense of a config.json will result in motor parameters changing. 

Example: 

```json
{
  "j0": { "limNeg": -180, "limPos": 180, "flip": true },
  "j1": { "limNeg": -140, "limPos": 80, "offset": -30 },
  "j2": { "limNeg": -140, "limPos": 80, "offset": -30 },
  "j3": { "limNeg": -180, "limPos": 80 },
  "j4": { "limNeg": -95, "limPos": 95, "offset": 8 },
  "j5": { "limNeg": -180, "limPos": 180 }
}
```

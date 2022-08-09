#!/usr/bin/env node

import {startServer} from './src/server.js';

// Define default config
const config = {
    port: 80,               // client port to connect to
	host: 'localhost',      // client url to connect to
    id: 1,                  // robot id
    ids: '0x10',            // can ids for motors
    mock: false             // if we want to mock robot
}

// Process the arguments
process.argv.forEach(function (val, i, arr) {
    switch( val ) {
        case "-p":
        case "--port":
            config.port = arr[i+1]
            break;
				case "-h":
        case "--host":
            config.host = arr[i+1]
            break;
        case "-ids":
        case "--can-ids":
            config.ids = arr[i+1]
            break;
        case "--mock":
            config.mock = true;
            break;
        default:
    }
});

// Map ids
config.ids = config.ids.split(',').map( id => +id )

// Log what we got
console.log(config);

// Start the server
startServer( config );

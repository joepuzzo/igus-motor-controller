#!/usr/bin/env node

import {startServer} from './src/server.js';

// Define default config
const config = {
	port: 80,
	host: 'localhost',
  id: 0x10,
  mock: false
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
        case "-id":
        case "--can-id":
            config.id = arr[i+1]
            break;
        case "--mock":
            config.mock = true;
            break;
        default:
    }
});

// Start the server
startServer( config );

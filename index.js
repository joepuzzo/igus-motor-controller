#!/usr/bin/env node

import {startServer} from './src/server.js';

// Define default config
const config = {
    port: 80,               // client port to connect to
	host: 'localhost',      // client url to connect to
    id: 1,                  // robot id
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
        case "--mock":
            config.mock = true;
            break;
        default:
    }
});

// Start the server
startServer( config );

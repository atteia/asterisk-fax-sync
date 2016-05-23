'use strict'

var domain = require('domain').create();
var os = require('os');
var moment = require('moment');
var config = require('config');
var debug = process.env.NODE_DEBUG || config.get('debug') || true;
var heartBeatInterval = null;

// On any errors. Write them to console and exit program with error code
domain.on('error', function(err) {
    if (debug) {
        console.log(moment(new Date()).format("YYYY-MM-DD HH:mm:ss"), err, err.stack);
    }

    process.exit(1);
});

// Encapsulate it all into a domain to catch all errors
domain.run(function() {
    "use strict";

    var knex = require('knex')({
        client: 'mysql',
        connection: {
            host: (process.env.MYSQL_HOST || mysql_config.get('host') || '127.0.0.1'),
            user: (process.env.MYSQL_USER || mysql_config.get('user') || 'root'),
            password: (process.env.MYSQL_PASSWORD || mysql_config.get('password') || ''),
            database: (process.env.MYSQL_DB || mysql_config.get('database') || 'asterisk')
        },
        pool: {
            ping: function(connection, callback) {
                connection.query({
                    sql: 'SELECT 1 = 1'
                }, [], callback);
            },
            pingTimeout: 3 * 1000,
            min: 1,
            max: 2
        }
    });

    if (heartBeatInterval) {
        clearInterval(heartBeatInterval)
        heartBeatInterval = null;
    }

    heartBeatInterval = setInterval(function() {
        knex.raw('SELECT 1=1')
            .then(function() {
                //  log.info('heartbeat sent');
            })
            .catch(function(err) {
                console.error('Knex heartbeat error, shutting down', err);
                process.exit(1);
            })
    }, 10000);

    let FaxProcessor = require('./faxprocessor');
    const ownServerName = 'odn1-voip-cluster02-upstream01'; //require('os').hostname();
    const faxDirectoryOut = '/var/spool/asterisk/fax/outgoing';
    const faxDirectoryIn = '/var/spool/asterisk/fax/incoming';
    const faxProcessor = new FaxProcessor(ownServerName, faxDirectoryOut, faxDirectoryIn, knex);
    
    mkdirp(faxDirectoryOut, function(err) {
        mkdirp(faxDirectoryIn, function(err) {
            let loop = () => {
                if (require('os').hostname().toString().indexOf('upstream') <= -1) {
                    return;
                }

                faxProcessor.processAndSendPendingFaxes()
                    .then(() => {
                        setTimeout(loop, config.get('update_interval_sec') * 1000);
                    });
            };

            loop();
        });
    });

});

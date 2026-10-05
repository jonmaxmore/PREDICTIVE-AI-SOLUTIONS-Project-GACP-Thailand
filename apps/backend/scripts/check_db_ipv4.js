const net = require('net');
const client = new net.Socket();
const port = 5432;
const host = 'localhost';
client.connect(port, host, function () {
    console.log('TCP Connection to 127.0.0.1:5432 successful');
    client.destroy();
    process.exit(0);
});
client.on('error', function (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
});

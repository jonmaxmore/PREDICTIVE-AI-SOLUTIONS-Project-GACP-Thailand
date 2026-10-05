const http = require('http');

const data = JSON.stringify({
    email: process.env.TEST_EMAIL || 'uat_Applicant_final@test.com',
    password: process.env.TEST_PASSWORD || 'Password123!',
});

const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/auth/health/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
    },
};

console.log('Sending Request...');
const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
    res.on('end', () => {
        console.log('No more data in response.');
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

// Write data to request body
req.write(data);
req.end();

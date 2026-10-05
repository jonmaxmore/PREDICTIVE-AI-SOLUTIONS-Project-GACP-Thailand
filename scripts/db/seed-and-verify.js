
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'gacp-local-dev-jwt-secret-2024';
const API_URL = 'http://localhost:5000/api';

async function run() {
    try {
        console.log('Starting Seed & Verify...');

        // 1. Find or Create User
        const email = 'verifier@gacp.com';
        let user = await prisma.user.findFirst({ where: { email } });

        if (!user) {
            console.log('Creating verifier user...');
            user = await prisma.user.create({
                data: {
                    email,
                    password: 'hashedpassword123', // Doesn't matter for token login
                    role: 'HEALTH',
                    accountType: 'INDIVIDUAL',
                    status: 'ACTIVE',
                    firstName: 'Verifier',
                    lastName: 'Bot',
                    phoneNumber: '0999999999'
                }
            });
            console.log('Verifier user created:', user.id);
        } else {
            console.log('Verifier user found:', user.id);
        }

        // 2. Generate Token
        const token = jwt.sign(
            { id: user.id, role: user.role, uuid: user.uuid },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        console.log('Token generated');

        // 3. Upload File
        console.log('Uploading file...');
        const dummyFilePath = path.join(__dirname, 'dummy.png');
        if (!fs.existsSync(dummyFilePath)) {
            fs.writeFileSync(dummyFilePath, 'dummy image content');
        }

        const formData = new FormData();
        formData.append('file', fs.createReadStream(dummyFilePath), {
            filename: 'dummy.png',
            contentType: 'image/png'
        });

        const uploadRes = await axios.post(`${API_URL}/uploads`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });

        if (!uploadRes.data.success) throw new Error('Upload failed: ' + JSON.stringify(uploadRes.data));
        const fileUrl = uploadRes.data.data.url;
        console.log(`File uploaded: ${fileUrl}`);

        // 4. Submit Application Draft
        console.log('Submitting application draft...');
        const draftData = {
            plantId: 'cannabis',
            serviceType: 'NEW',
            areaType: 'OUTDOOR',
            documents: [
                {
                    id: 'doc_1',
                    uploaded: true,
                    url: fileUrl,
                    name: 'dummy.png',
                    type: 'image/png'
                }
            ]
        };

        const draftRes = await axios.post(`${API_URL}/applications/draft`, draftData, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!draftRes.data.success) throw new Error('Draft submission failed');
        console.log('Draft submitted successfully');

        // 5. Verify Application Data
        console.log('Verifying application data...');
        const myAppsRes = await axios.get(`${API_URL}/applications/my`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const myApp = myAppsRes.data.data[0];
        if (!myApp) throw new Error('No application found');

        const storedDocs = myApp.formData.documents;
        console.log('Stored Documents:', JSON.stringify(storedDocs, null, 2));

        if (storedDocs && storedDocs.some(d => d.url === fileUrl)) {
            console.log('SUCCESS: Document URL verified in application data!');
            console.log('FINAL VERIFICATION PASSED');
        } else {
            console.error('FAILURE: Document URL not found in application data');
            process.exit(1);
        }

        // Cleanup
        fs.unlinkSync(dummyFilePath);

    } catch (error) {
        console.error('Test Failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

run();

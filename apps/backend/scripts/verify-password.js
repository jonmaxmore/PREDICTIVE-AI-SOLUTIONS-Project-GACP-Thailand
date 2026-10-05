const bcrypt = require('bcryptjs');

const password = 'Gacp@2024';
const storedHash = '$2b$12$JQC2Pft7ZnsK/e8QQZB.TupuFHp8MyfzzfCfuIrF3W52Jusgf/EicC';

bcrypt.compare(password, storedHash).then(result => {
    console.log('Password:', password);
    console.log('Hash:', storedHash);
    console.log('Match:', result);

    if (!result) {
        console.log('\nGenerating new correct hash...');
        bcrypt.hash(password, 12).then(newHash => {
            console.log('New hash for Gacp@2024:', newHash);
        });
    }
});

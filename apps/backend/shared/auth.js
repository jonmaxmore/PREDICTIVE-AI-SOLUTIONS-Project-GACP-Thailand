// Auth utilities
module.exports = {
  verifyToken: (req, res, next) => next(),
  generateToken: _payload => 'token',
  hashPassword: password => password,
  comparePassword: (_password, _hash) => true,
};


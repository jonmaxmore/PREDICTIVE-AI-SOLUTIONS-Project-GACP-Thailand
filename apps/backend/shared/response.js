// Response utilities
module.exports = {
  success: (res, data, message = 'Success') => {
    res.json({
      success: true,
      message,
      data,
    });
  },
  error: (res, message, statusCode = 500) => {
    res.status(statusCode).json({
      success: false,
      error: message,
    });
  },
};


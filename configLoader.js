const fs = require('fs');
const userConfigFile = `${process.cwd()}/config.js`;
module.exports.path = process.cwd();
if (fs.existsSync(userConfigFile)) {
  module.exports = require(userConfigFile);
}
else {
  module.exports = require('./config.js');
}

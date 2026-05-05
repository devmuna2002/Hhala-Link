const { sha512 } = require('js-sha512');

const INTEGRATION_KEY = '1b373b30-974b-4b99-91a4-e5967d3596e9';

function generateHash(data) {
  let combinedString = '';
  const sortedKeys = Object.keys(data).sort();
  for (const key of sortedKeys) {
    const val = data[key];
    if (val !== '' && val !== null && val !== undefined) {
      combinedString += val;
    }
  }
  combinedString += INTEGRATION_KEY;
  console.log("String to hash:", combinedString);
  return sha512(combinedString).toUpperCase();
}

// BARE MINIMUM DATA (as updated in my PaynowService fix)
const data = {
  id: '24487',
  reference: 'SUB-12345',
  amount: '5.00',
  authemail: 'test@example.com',
  phone: '0777123456',
  method: 'ecocash',
  status: 'Message'
};

console.log("New simplified hash:", generateHash(data));

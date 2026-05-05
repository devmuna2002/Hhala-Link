import { sha512 } from 'js-sha512';

// NEW UPDATED CREDENTIALS
const INTEGRATION_ID = '24553';
const INTEGRATION_KEY = 'd1ee6ef9-67a9-4fb0-a3a8-89cf85462688';

const API_URL_REMOTE = 'https://www.paynow.co.zw/interface/remotetransaction';
const API_URL_INITIATE = 'https://www.paynow.co.zw/interface/initiatetransaction';

export const PaynowService = {

  generateHash(data) {
    let combinedString = "";

    // 1. Sort keys alphabetically
    const sortedKeys = Object.keys(data).sort();

    // 2. Concatenate values
    for (const k of sortedKeys) {
      if (data[k] !== undefined && data[k] !== null && data[k] !== "") {
        combinedString += data[k].toString();
      }
    }

    // 3. Append the Integration Key
    combinedString += INTEGRATION_KEY;

    return sha512(combinedString).toUpperCase();
  },

  async initiateMobileTransaction({ amount, email, reference, phone, method }) {
    const data = {
      'id': INTEGRATION_ID,
      'reference': reference,
      'amount': amount.toFixed(2),
      'authemail': email || '',
      'phone': phone,
      'method': method,
      'status': 'Message',
      'resulturl': 'https://hlala-link.web.app/api/paynow-webhook',
      'returnurl': 'https://hlala-link.web.app/payment-success'
    };

    const hash = this.generateHash(data);

    const body = new URLSearchParams();
    Object.keys(data).sort().forEach(key => {
      if (data[key]) body.append(key, data[key]);
    });
    body.append('hash', hash);

    try {
      const response = await fetch(API_URL_REMOTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });

      const resText = await response.text();
      const res = this.parseResponse(resText);

      if (res.status && res.status.toLowerCase() === 'ok') {
        return { success: true, pollurl: res.pollurl };
      } else {
        console.error("Paynow Error:", res.error);
        return { success: false, error: res.error || 'Initiation failed' };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async initiateTransaction({ amount, email, reference }) {
    const data = {
      'id': INTEGRATION_ID,
      'reference': reference,
      'amount': amount.toFixed(2),
      'additionalinfo': 'Hlala Link Subscription',
      'returnurl': 'https://hlala-link.web.app/payment-success',
      'resulturl': 'https://hlala-link.web.app/api/paynow-webhook',
      'authemail': email || '',
      'status': 'Message'
    };

    const hash = this.generateHash(data);
    const body = new URLSearchParams();
    Object.keys(data).sort().forEach(key => body.append(key, data[key]));
    body.append('hash', hash);

    try {
      const response = await fetch(API_URL_INITIATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });

      const resText = await response.text();
      const res = this.parseResponse(resText);

      if (res.status && res.status.toLowerCase() === 'ok') {
        return { success: true, browserurl: res.browserurl, pollurl: res.pollurl };
      } else {
        return { success: false, error: res.error || 'Web initiation failed' };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async initiateCardTransaction({ amount, email, reference, cardDetails }) {
    const data = {
      'id': INTEGRATION_ID,
      'reference': reference,
      'amount': amount.toFixed(2),
      'authemail': email || '',
      'cardnumber': cardDetails.number.replace(/\s/g, ''),
      'cardcvv': cardDetails.cvv,
      'cardexpiry': cardDetails.expiry.replace('/', ''), // format: MMYY
      'cardholder': cardDetails.holder,
      'status': 'Message',
      'resulturl': 'https://hlala-link.web.app/api/paynow-webhook',
      'returnurl': 'https://hlala-link.web.app/payment-success'
    };

    const hash = this.generateHash(data);
    const body = new URLSearchParams();
    Object.keys(data).sort().forEach(key => body.append(key, data[key]));
    body.append('hash', hash);

    try {
      const response = await fetch(API_URL_INITIATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });

      const resText = await response.text();
      
      // If the response is HTML, it's an error page from Paynow
      if (resText.includes('<!DOCTYPE html>') || resText.includes('<html')) {
        return { success: false, error: 'Paynow returned an error page. Please check if your Integration ID is authorized for Direct Card payments.' };
      }

      const res = this.parseResponse(resText);

      if (res.status && res.status.toLowerCase() === 'ok') {
        return { 
          success: true, 
          browserurl: res.browserurl, 
          pollurl: res.pollurl,
          requires3DS: !!res.browserurl 
        };
      } else {
        return { success: false, error: res.error || 'Card initiation failed' };
      }
    } catch (e) { 
      return { success: false, error: e.message }; 
    }
  },

  parseResponse(text) {
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [key, value] of params) {
      obj[key] = value;
    }
    return obj;
  },

  async pollStatus(pollUrl) {
    try {
      const response = await fetch(pollUrl);
      const text = await response.text();
      return this.parseResponse(text);
    } catch (e) {
      return null;
    }
  }
};

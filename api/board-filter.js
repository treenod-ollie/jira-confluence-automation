const axios = require('axios');
const { JIRA_URL, getHeaders } = require('../lib/atlassian');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/2/filter/10359`,
      { headers: getHeaders() }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

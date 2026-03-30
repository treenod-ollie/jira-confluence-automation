const axios = require('axios');
const cheerio = require('cheerio');

const JIRA_URL = process.env.JIRA_URL;
const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const API_TOKEN = process.env.ATLASSIAN_API_TOKEN;
const EMAIL = process.env.ATLASSIAN_EMAIL;
const PROJECT = process.env.JIRA_PROJECT;
const PARENT_ISSUE = 'LT-16';
const BOARD_ID = '294';

function getAuthHeader() {
  return Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
}

function getHeaders() {
  return {
    'Authorization': `Basic ${getAuthHeader()}`,
    'Content-Type': 'application/json'
  };
}

async function searchPageByBuildNumber(buildNumber) {
  const response = await axios.get(
    `${CONFLUENCE_URL}/rest/api/content/search`,
    {
      params: {
        cql: `title ~ "[PKPK]${buildNumber}" AND type = page`,
        expand: 'body.storage',
        limit: 5
      },
      headers: getHeaders()
    }
  );

  if (response.data.results.length === 0) {
    throw new Error(`"[PKPK]${buildNumber}" 페이지를 찾을 수 없습니다.`);
  }

  return response.data.results[0];
}

async function getChildPages(pageId) {
  const response = await axios.get(
    `${CONFLUENCE_URL}/rest/api/content/${pageId}/child/page`,
    {
      params: { limit: 100, expand: 'body.storage' },
      headers: getHeaders()
    }
  );
  return response.data.results;
}

async function getUserByName(displayName) {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/3/user/search`,
      {
        params: { query: displayName },
        headers: getHeaders()
      }
    );
    if (response.data.length > 0) {
      return response.data[0].accountId;
    }
    return null;
  } catch (error) {
    console.error('사용자 검색 오류:', error.message);
    return null;
  }
}

function extractTasksFromPage(pageHtml) {
  const tasks = [];
  const $ = cheerio.load(pageHtml);
  const tables = $('table');

  tables.each((tableIndex, table) => {
    const headers = [];
    $(table).find('tbody tr:first th').each((i, cell) => {
      headers.push($(cell).text().trim());
    });

    if (headers.length === 0) return;

    const assigneeColIndex = headers.findIndex(h =>
      h.includes('스펙 담당자') || h.includes('담당자')
    );
    if (assigneeColIndex === -1) return;

    $(table).find('tbody tr').slice(1).each((rowIndex, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;

      const title = cells.eq(1).text().trim();
      const assigneeCellHtml = cells.eq(assigneeColIndex).html() || '';
      const accountIdMatch = assigneeCellHtml.match(/ri:account-id="([^"]+)"/g);

      if (title && accountIdMatch) {
        const accountIds = accountIdMatch.map(m => m.match(/ri:account-id="([^"]+)"/)[1]);
        if (accountIds.length > 0) {
          tasks.push({ title, accountIds });
        }
      }
    });
  });

  return tasks;
}

function extractDevelopmentPeriod(pageHtml) {
  const $ = cheerio.load(pageHtml);
  const period = { startDate: null, endDate: null };
  const text = $.text();

  const techMatch = text.match(/테크[^0-9]*(\d{4}년\s+\d{1,2}월\s+\d{1,2}일)/);
  const devMatch = text.match(/개발[^0-9]*(\d{4}년\s+\d{1,2}월\s+\d{1,2}일)[^0-9]*(\d{4}년\s+\d{1,2}월\s+\d{1,2}일)/);

  if (techMatch) period.startDate = convertKoreanDateToISO(techMatch[1]);
  if (devMatch) period.endDate = convertKoreanDateToISO(devMatch[2]);

  return period;
}

function convertKoreanDateToISO(koreanDate) {
  const match = koreanDate.match(/(\d{4})년\s+(\d{1,2})월\s+(\d{1,2})일/);
  if (match) {
    return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  }
  return null;
}

async function createJiraTicket(issueData) {
  const response = await axios.post(
    `${JIRA_URL}/rest/api/2/issue`,
    issueData,
    { headers: getHeaders() }
  );
  return response.data;
}

async function getAvailableTransitions(issueKey) {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/2/issue/${issueKey}/transitions`,
      { headers: getHeaders() }
    );
    return response.data.transitions;
  } catch (error) {
    console.error(`상태 전환 조회 오류 (${issueKey}):`, error.message);
    return [];
  }
}

async function transitionIssue(issueKey, targetStatus) {
  try {
    const transitions = await getAvailableTransitions(issueKey);
    const targetTransition = transitions.find(t => t.to.name === targetStatus);

    if (!targetTransition) {
      console.log(`[경고] "${targetStatus}" 상태로 전환 불가능 (${issueKey})`);
      return false;
    }

    await axios.post(
      `${JIRA_URL}/rest/api/2/issue/${issueKey}/transitions`,
      { transition: { id: targetTransition.id } },
      { headers: getHeaders() }
    );
    return true;
  } catch (error) {
    console.error(`상태 전환 오류 (${issueKey}):`, error.message);
    return false;
  }
}

module.exports = {
  JIRA_URL,
  PROJECT,
  PARENT_ISSUE,
  BOARD_ID,
  getHeaders,
  searchPageByBuildNumber,
  getChildPages,
  getUserByName,
  extractTasksFromPage,
  extractDevelopmentPeriod,
  createJiraTicket,
  transitionIssue
};

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const JIRA_URL = process.env.JIRA_URL;
const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const API_TOKEN = process.env.ATLASSIAN_API_TOKEN;
const EMAIL = process.env.ATLASSIAN_EMAIL;
const PROJECT = process.env.JIRA_PROJECT;
const PARENT_ISSUE = 'LT-16';
const BOARD_ID = '294'; // 보드 ID

const authHeader = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

// Confluence에서 페이지 정보 조회
async function getConfluencePage(pageId) {
  try {
    const response = await axios.get(
      `${CONFLUENCE_URL}/rest/api/content/${pageId}?expand=body.storage`,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Confluence API 오류:', error.message);
    throw error;
  }
}

// 빌드 번호로 페이지 검색
async function searchPageByBuildNumber(buildNumber) {
  try {
    const response = await axios.get(
      `${CONFLUENCE_URL}/rest/api/content/search`,
      {
        params: {
          cql: `title ~ "[PKPK]${buildNumber}" AND type = page`,
          expand: 'body.storage',
          limit: 5
        },
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.results.length === 0) {
      throw new Error(`"[PKPK]${buildNumber}" 페이지를 찾을 수 없습니다.`);
    }

    return response.data.results[0];
  } catch (error) {
    console.error('페이지 검색 오류:', error.message);
    throw error;
  }
}

// 하위 페이지들 조회
async function getChildPages(pageId) {
  try {
    const response = await axios.get(
      `${CONFLUENCE_URL}/rest/api/content/${pageId}/child/page`,
      {
        params: {
          limit: 100,
          expand: 'body.storage'
        },
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.results;
  } catch (error) {
    console.error('하위 페이지 조회 오류:', error.message);
    throw error;
  }
}

// 사용자 account-id로 사용자명 조회
async function getUserNameFromAccountId(accountId) {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/3/users`,
      {
        params: {
          accountId: accountId
        },
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.length > 0) {
      return response.data[0].displayName;
    }
    return null;
  } catch (error) {
    console.error('사용자 조회 오류:', error.message);
    return null;
  }
}

// 페이지에서 작업 정보 추출
async function extractTasksFromPage(pageHtml, targetAssignee) {
  const tasks = [];
  const $ = cheerio.load(pageHtml);

  // 테이블 찾기
  const tables = $('table');

  tables.each((tableIndex, table) => {
    const headers = [];

    // 헤더 추출 (첫 번째 행의 th들)
    $(table).find('tbody tr:first th').each((i, cell) => {
      const text = $(cell).text().trim();
      headers.push(text);
    });

    // 헤더가 없으면 스킵
    if (headers.length === 0) return;

    // 스펙 담당자 컬럼 인덱스 찾기
    const assigneeColIndex = headers.findIndex(h =>
      h.includes('스펙 담당자') || h.includes('담당자')
    );

    if (assigneeColIndex === -1) return; // 담당자 컬럼 없으면 스킵

    // 데이터 행 추출 (첫 번째 행 제외)
    $(table).find('tbody tr').slice(1).each((rowIndex, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;

      // 제목은 두 번째 셀 (인덱스 1)
      const titleCell = cells.eq(1);
      const title = titleCell.text().trim();

      // 담당자 정보 추출 (account-id 찾기)
      const assigneeCell = cells.eq(assigneeColIndex);
      const assigneeCellHtml = assigneeCell.html() || '';
      const accountIdMatch = assigneeCellHtml.match(/ri:account-id="([^"]+)"/g);

      if (title && accountIdMatch) {
        const accountIds = accountIdMatch.map(m => m.match(/ri:account-id="([^"]+)"/)[1]);
        if (accountIds.length > 0) {
          tasks.push({
            title: title,
            accountIds: accountIds
          });
        }
      }
    });
  });

  return tasks;
}

// 페이지에서 개발 기간 추출
function extractDevelopmentPeriod(pageHtml) {
  const $ = cheerio.load(pageHtml);
  const period = {
    startDate: null,
    endDate: null
  };

  // "테크" 또는 "개발 기간" 찾기
  const text = $.text();
  const techMatch = text.match(/테크[^0-9]*(\d{4}년\s+\d{1,2}월\s+\d{1,2}일)/);
  const devMatch = text.match(/개발[^0-9]*(\d{4}년\s+\d{1,2}월\s+\d{1,2}일)[^0-9]*(\d{4}년\s+\d{1,2}월\s+\d{1,2}일)/);

  if (techMatch) {
    period.startDate = convertKoreanDateToISO(techMatch[1]);
  }

  if (devMatch) {
    period.endDate = convertKoreanDateToISO(devMatch[2]);
  }

  return period;
}

// 한글 날짜를 ISO 형식으로 변환
function convertKoreanDateToISO(koreanDate) {
  // "2026년 2월 26일" -> "2026-02-26"
  const match = koreanDate.match(/(\d{4})년\s+(\d{1,2})월\s+(\d{1,2})일/);
  if (match) {
    const year = match[1];
    const month = String(match[2]).padStart(2, '0');
    const day = String(match[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

// 사용자 정보 조회 (담당자)
async function getUserByName(displayName) {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/3/user/search`,
      {
        params: {
          query: displayName
        },
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
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

// 현재 스프린트 ID 조회
async function getActiveSprint() {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/agile/1.0/board/${BOARD_ID}/sprint`,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.values && response.data.values.length > 0) {
      // 활성 스프린트 찾기
      const activeSprint = response.data.values.find(sprint => sprint.state === 'ACTIVE');
      if (activeSprint) {
        return activeSprint.id;
      }
      // 활성 스프린트가 없으면 첫 번째 스프린트 사용
      return response.data.values[0].id;
    }
    return null;
  } catch (error) {
    console.error('스프린트 조회 오류:', error.message);
    console.error('응답 상태:', error.response?.status);
    console.error('응답 데이터:', error.response?.data);
    return null;
  }
}

// 이슈의 가능한 상태 전환 조회
async function getAvailableTransitions(issueKey) {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/2/issue/${issueKey}/transitions`,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.transitions;
  } catch (error) {
    console.error(`상태 전환 조회 오류 (${issueKey}):`, error.message);
    return [];
  }
}

// 이슈 상태 전환
async function transitionIssue(issueKey, targetStatus) {
  try {
    const transitions = await getAvailableTransitions(issueKey);
    const targetTransition = transitions.find(t => t.to.name === targetStatus);

    if (!targetTransition) {
      console.log(`[경고] "${targetStatus}" 상태로 전환 불가능 (${issueKey}) - 가능한 상태: ${transitions.map(t => t.to.name).join(', ')}`);
      return false;
    }

    await axios.post(
      `${JIRA_URL}/rest/api/2/issue/${issueKey}/transitions`,
      {
        transition: {
          id: targetTransition.id
        }
      },
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`${issueKey} → "${targetStatus}" 상태로 전환됨`);
    return true;
  } catch (error) {
    console.error(`상태 전환 오류 (${issueKey}):`, error.message);
    return false;
  }
}

// JIRA 티켓 생성
async function createJiraTicket(issueData) {
  try {
    console.log('티켓 생성 요청:', JSON.stringify(issueData, null, 2));
    const response = await axios.post(
      `${JIRA_URL}/rest/api/2/issue`,
      issueData,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('JIRA 티켓 생성 오류 상태:', error.response?.status);
    console.error('JIRA 티켓 생성 오류 데이터:', error.response?.data);
    console.error('JIRA 티켓 생성 오류 메시지:', error.message);
    throw error;
  }
}

// 보드 설정 조회 (디버깅용)
app.get('/api/board-config', async (req, res) => {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/agile/1.0/board/${BOARD_ID}/configuration`,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('보드 설정 조회 오류:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 보드 필터 조회 (디버깅용)
app.get('/api/board-filter', async (req, res) => {
  try {
    const response = await axios.get(
      `${JIRA_URL}/rest/api/2/filter/10359`,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('보드 필터 조회 오류:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API 라우트
app.post('/api/create-tickets', async (req, res) => {
  try {
    const { buildNumber, assignee } = req.body;

    if (!buildNumber || !assignee) {
      return res.status(400).json({ error: '빌드 번호와 담당자를 입력해주세요.' });
    }

    // 빌드 번호로 상위 페이지 검색
    const parentPage = await searchPageByBuildNumber(buildNumber);
    console.log(`찾은 페이지: ${parentPage.title}`);

    // 하위 페이지들 조회
    const childPages = await getChildPages(parentPage.id);
    console.log(`하위 페이지 수: ${childPages.length}`);

    if (childPages.length === 0) {
      return res.status(400).json({ error: '하위 페이지가 없습니다.' });
    }

    // 대상 담당자의 JIRA account-id 조회
    const assigneeAccountId = await getUserByName(assignee.replace('@', '').trim());
    if (!assigneeAccountId) {
      return res.status(400).json({ error: `담당자 "${assignee}"를 찾을 수 없습니다.` });
    }

    const createdTickets = [];
    const errors = [];

    // 각 하위 페이지에서 작업 정보 추출
    for (const childPage of childPages) {
      try {
        const pageHtml = childPage.body.storage.value;
        const pageTitle = childPage.title;

        // 개발 기간 추출
        const period = extractDevelopmentPeriod(pageHtml);

        // 작업 정보 추출
        const tasks = await extractTasksFromPage(pageHtml, assignee);
        console.log(`${pageTitle}에서 찾은 작업: ${tasks.length}개`);

        // 대상 담당자의 작업만 필터링
        for (const task of tasks) {
          if (task.accountIds.includes(assigneeAccountId)) {
            // 티켓 생성
            const issueData = {
              fields: {
                project: { key: PROJECT },
                summary: `[${buildNumber}] ${task.title}`,
                issuetype: { name: '작업' },
                priority: { name: 'Medium' },
                parent: { key: PARENT_ISSUE },
                assignee: { accountId: assigneeAccountId },
                description: `페이지: ${pageTitle}\n작업: ${task.title}`
              }
            };

            // 마감일 설정 (기본값: 2주 뒤)
            if (period.endDate) {
              issueData.fields.duedate = period.endDate;
            } else {
              // 기한을 찾지 못하면 2주 뒤로 설정
              const defaultDueDate = new Date();
              defaultDueDate.setDate(defaultDueDate.getDate() + 14);
              issueData.fields.duedate = defaultDueDate.toISOString().split('T')[0];
              console.log(`[경고] 기한 미설정 - 기본값 사용: ${issueData.fields.duedate}`);
            }

            const ticket = await createJiraTicket(issueData);

            // 티켓 상태를 "할 일"로 전환하여 보드에 표시되도록 함
            await transitionIssue(ticket.key, '할 일');

            createdTickets.push({
              title: task.title,
              ticketKey: ticket.key,
              ticketUrl: `${JIRA_URL}/browse/${ticket.key}`
            });
          }
        }
      } catch (error) {
        errors.push({
          page: childPage.title,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      createdTickets,
      errors: errors.length > 0 ? errors : null,
      total: createdTickets.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`http://localhost:${PORT}`);
});

#!/usr/bin/env node

const axios = require('axios');
const cheerio = require('cheerio');
const { Command } = require('commander');
require('dotenv').config();

const JIRA_URL = process.env.JIRA_URL;
const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const API_TOKEN = process.env.ATLASSIAN_API_TOKEN;
const EMAIL = process.env.ATLASSIAN_EMAIL;
const PROJECT = process.env.JIRA_PROJECT;
const PARENT_ISSUE = 'LT-16';

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
    throw new Error(`Confluence API 오류: ${error.message}`);
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
    throw new Error(`하위 페이지 조회 오류: ${error.message}`);
  }
}

// 페이지에서 작업 정보 추출
async function extractTasksFromPage(pageHtml) {
  const tasks = [];
  const $ = cheerio.load(pageHtml);

  const tables = $('table');

  tables.each((tableIndex, table) => {
    const headers = [];

    $(table).find('tbody tr:first th').each((i, cell) => {
      const text = $(cell).text().trim();
      headers.push(text);
    });

    if (headers.length === 0) return;

    const assigneeColIndex = headers.findIndex(h =>
      h.includes('스펙 담당자') || h.includes('담당자')
    );

    if (assigneeColIndex === -1) return;

    $(table).find('tbody tr').slice(1).each((rowIndex, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;

      const titleCell = cells.eq(1);
      const title = titleCell.text().trim();

      const assigneeCell = cells.eq(assigneeColIndex);
      const assigneeCellHtml = assigneeCell.html() || '';
      const accountIdMatch = assigneeCellHtml.match(/ri:account-id="([^\"]+)"/g);

      if (title && accountIdMatch) {
        const accountIds = accountIdMatch.map(m => m.match(/ri:account-id="([^\"]+)"/)[1]);
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

  const text = $.text();
  const techMatch = text.match(/테크[^0-9]*(\\d{4}년\\s+\\d{1,2}월\\s+\\d{1,2}일)/);
  const devMatch = text.match(/개발[^0-9]*(\\d{4}년\\s+\\d{1,2}월\\s+\\d{1,2}일)[^0-9]*(\\d{4}년\\s+\\d{1,2}월\\s+\\d{1,2}일)/);

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
  const match = koreanDate.match(/(\\d{4})년\\s+(\\d{1,2})월\\s+(\\d{1,2})일/);
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
    return null;
  }
}

// JIRA 티켓 생성
async function createJiraTicket(issueData) {
  try {
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
    throw new Error(`JIRA 티켓 생성 오류: ${error.response?.data?.errors?.summary || error.message}`);
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
    return [];
  }
}

// 이슈 상태 전환
async function transitionIssue(issueKey, targetStatus) {
  try {
    const transitions = await getAvailableTransitions(issueKey);
    const targetTransition = transitions.find(t => t.to.name === targetStatus);

    if (!targetTransition) {
      console.log(`⚠️  "${targetStatus}" 상태로 전환 불가능`);
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
    return true;
  } catch (error) {
    return false;
  }
}

// 메인 함수
async function main(buildNumber, assignee) {
  console.log(`\n🚀 JIRA 티켓 생성 시작`);
  console.log(`   빌드: [PKPK]${buildNumber}`);
  console.log(`   담당자: ${assignee}\n`);

  try {
    // 빌드 번호로 상위 페이지 검색
    console.log(`📄 Confluence 페이지 검색 중...`);
    const parentPage = await searchPageByBuildNumber(buildNumber);
    console.log(`✅ 찾은 페이지: ${parentPage.title}`);

    // 하위 페이지들 조회
    console.log(`\n📚 하위 페이지 조회 중...`);
    const childPages = await getChildPages(parentPage.id);
    console.log(`✅ 하위 페이지: ${childPages.length}개`);

    if (childPages.length === 0) {
      throw new Error('하위 페이지가 없습니다.');
    }

    // 대상 담당자의 JIRA account-id 조회
    console.log(`\n👤 담당자 정보 조회 중...`);
    const assigneeAccountId = await getUserByName(assignee.replace('@', '').trim());
    if (!assigneeAccountId) {
      throw new Error(`담당자 "${assignee}"를 찾을 수 없습니다.`);
    }
    console.log(`✅ 담당자 ID: ${assigneeAccountId}`);

    // 각 하위 페이지에서 작업 정보 추출 및 티켓 생성
    console.log(`\n🎯 티켓 생성 중...\n`);
    const createdTickets = [];
    const errors = [];

    for (const childPage of childPages) {
      try {
        const pageHtml = childPage.body.storage.value;
        const pageTitle = childPage.title;

        // 개발 기간 추출
        const period = extractDevelopmentPeriod(pageHtml);

        // 작업 정보 추출
        const tasks = await extractTasksFromPage(pageHtml);

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

            // 마감일 설정
            if (period.endDate) {
              issueData.fields.duedate = period.endDate;
            } else {
              const defaultDueDate = new Date();
              defaultDueDate.setDate(defaultDueDate.getDate() + 14);
              issueData.fields.duedate = defaultDueDate.toISOString().split('T')[0];
            }

            const ticket = await createJiraTicket(issueData);

            // 티켓 상태를 "할 일"로 전환
            await transitionIssue(ticket.key, '할 일');

            createdTickets.push({
              title: task.title,
              ticketKey: ticket.key,
              ticketUrl: `${JIRA_URL}/browse/${ticket.key}`
            });

            console.log(`   ✅ ${ticket.key} - ${task.title}`);
          }
        }
      } catch (error) {
        errors.push({
          page: childPage.title,
          error: error.message
        });
      }
    }

    // 결과 출력
    console.log(`\n✨ 완료!\n`);
    console.log(`📊 결과:`);
    console.log(`   생성된 티켓: ${createdTickets.length}개`);

    if (errors.length > 0) {
      console.log(`   오류: ${errors.length}개`);
      errors.forEach(e => {
        console.log(`      - ${e.page}: ${e.error}`);
      });
    }

    console.log();
    createdTickets.forEach(ticket => {
      console.log(`   🔗 ${ticket.ticketKey}: ${ticket.title}`);
    });
    console.log();

  } catch (error) {
    console.error(`\n❌ 오류: ${error.message}\n`);
    process.exit(1);
  }
}

// CLI 설정
const program = new Command();

program
  .name('create-tickets')
  .description('Confluence 페이지에서 JIRA 티켓을 자동 생성합니다')
  .version('1.0.0')
  .requiredOption('-b, --build <number>', '빌드 번호 (예: 3.33.0)')
  .requiredOption('-a, --assignee <name>', '담당자명 (예: Ollie)')
  .action((options) => {
    main(options.build, options.assignee);
  });

program.parse(process.argv);

const {
  JIRA_URL, PROJECT, PARENT_ISSUE,
  searchPageByBuildNumber, getChildPages, getUserByName,
  extractTasksFromPage, extractDevelopmentPeriod,
  createJiraTicket, transitionIssue
} = require('../lib/atlassian');
const { checkIp } = require('../lib/ip-guard');

module.exports = async function handler(req, res) {
  if (!checkIp(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { buildNumber, assignee } = req.body;

    if (!buildNumber || !assignee) {
      return res.status(400).json({ error: '빌드 번호와 담당자를 입력해주세요.' });
    }

    const parentPage = await searchPageByBuildNumber(buildNumber);
    const childPages = await getChildPages(parentPage.id);

    if (childPages.length === 0) {
      return res.status(400).json({ error: '하위 페이지가 없습니다.' });
    }

    const assigneeAccountId = await getUserByName(assignee.replace('@', '').trim());
    if (!assigneeAccountId) {
      return res.status(400).json({ error: `담당자 "${assignee}"를 찾을 수 없습니다.` });
    }

    const createdTickets = [];
    const errors = [];

    for (const childPage of childPages) {
      try {
        const pageHtml = childPage.body.storage.value;
        const pageTitle = childPage.title;
        const period = extractDevelopmentPeriod(pageHtml);
        const tasks = extractTasksFromPage(pageHtml);

        for (const task of tasks) {
          if (task.accountIds.includes(assigneeAccountId)) {
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

            if (period.endDate) {
              issueData.fields.duedate = period.endDate;
            } else {
              const defaultDueDate = new Date();
              defaultDueDate.setDate(defaultDueDate.getDate() + 14);
              issueData.fields.duedate = defaultDueDate.toISOString().split('T')[0];
            }

            const ticket = await createJiraTicket(issueData);
            await transitionIssue(ticket.key, '할 일');

            createdTickets.push({
              title: task.title,
              ticketKey: ticket.key,
              ticketUrl: `${JIRA_URL}/browse/${ticket.key}`
            });
          }
        }
      } catch (error) {
        errors.push({ page: childPage.title, error: error.message });
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
};

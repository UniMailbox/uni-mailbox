import { expect, test as base } from "@playwright/test";

type ProductionLocale = "en" | "zh-CN";
export type LocaleFixture = {
  readonly code: ProductionLocale | "ar-XB";
  readonly copy: Record<string, string>;
};

const copy: Record<ProductionLocale, Record<string, string>> = {
  en: {
    loginTitle: "Sign in to your mail plane.", email: "Email address", password: "Password", submit: "Enter workspace",
    inbox: "Inbox", sent: "Sent", compose: "Compose message", composeButton: "Compose", to: "To", subject: "Subject", attach: "Attach file", saveDraft: "Save draft", saved: "Saved to server", send: "Send message", loadMore: "Load older messages", star: "Star message", archive: "Archive message",
    attachmentReady: "1 attachment ready", reply: "Reply", mailboxes: "Mailboxes", share: "Share mailbox", memberId: "Member user ID", mailboxRole: "Mailbox role", sharing: "Manage sharing",
    storageTitle: "Infrastructure", kvActive: "KV storage is active", kvHealthy: "KV healthy", verifyR2: "Verify R2 write access",
    cloudflareTitle: "Cloudflare Mail", controlPlane: "Connect the control plane", domainHeading: "Email Routing domain", brevo: "Connect Brevo",
    preferences: "Language & region", language: "Language", english: "English", chinese: "简体中文", administration: "Administration", users: "Users", create: "Create", emailField: "Email address", displayName: "Display name", passwordField: "Temporary password", roleIds: "Role IDs (comma-separated)",
  },
  "zh-CN": {
    loginTitle: "登录您的邮件工作区。", email: "电子邮件地址", password: "密码", submit: "进入工作区",
    inbox: "收件箱", sent: "已发送", compose: "撰写邮件", composeButton: "撰写邮件", to: "收件人", subject: "主题", attach: "添加附件", saveDraft: "保存草稿", saved: "已保存到服务器", send: "发送邮件", loadMore: "加载较早邮件", star: "为邮件加星标", archive: "归档邮件",
    attachmentReady: "1 个附件已就绪", reply: "回复", mailboxes: "邮箱", share: "共享邮箱", memberId: "成员用户 ID", mailboxRole: "邮箱角色", sharing: "管理共享",
    storageTitle: "基础设施", kvActive: "KV 存储正在使用", kvHealthy: "KV 正常", verifyR2: "验证 R2 写入权限",
    cloudflareTitle: "Cloudflare 邮件", controlPlane: "连接控制平面", domainHeading: "Email Routing 域名", brevo: "连接 Brevo",
    preferences: "语言与地区", language: "语言", english: "English", chinese: "简体中文", administration: "管理", users: "用户", create: "创建", emailField: "电子邮件地址", displayName: "显示名称", passwordField: "临时密码", roleIds: "角色 ID（以逗号分隔）",
  },
};

function projectLocale(name: string): LocaleFixture["code"] {
  if (name === "zh-CN") return "zh-CN";
  if (name.startsWith("rtl-")) return "ar-XB";
  return "en";
}

export const test = base.extend<{ uiLocale: LocaleFixture }>({
  uiLocale: [
    async ({ page }, use, testInfo) => {
      const code = projectLocale(testInfo.project.name);
      await page.addInitScript((locale) => {
        window.localStorage.setItem("unimailbox.locale", locale);
      }, code);
      await use({ code, copy: code === "zh-CN" ? copy["zh-CN"] : copy.en });
    },
    { auto: true },
  ],
});

export { expect };

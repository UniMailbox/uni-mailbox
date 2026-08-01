import { expect, test as base } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

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
    storageTitle: "Infrastructure", kvActive: "KV storage is active", kvHealthy: "KV healthy", verifyR2: "Verify R2 write access", signOut: "Sign out", accountEmail: "New login email", currentPassword: "Current password", updateEmail: "Update login email", notFound: "This page was not found", forbidden: "You do not have access to this area",
    cloudflareTitle: "Cloudflare Mail", controlPlane: "Connect the control plane", domainHeading: "Email Routing domain", brevo: "Connect Brevo",
    preferences: "Language & region", language: "Language", english: "English", chinese: "简体中文", administration: "Administration", users: "Users", create: "Create", emailField: "Email address", displayName: "Display name", passwordField: "Temporary password", roleIds: "Role IDs (comma-separated)",
  },
  "zh-CN": {
    loginTitle: "登录您的邮件工作区。", email: "电子邮件地址", password: "密码", submit: "进入工作区",
    inbox: "收件箱", sent: "已发送", compose: "撰写邮件", composeButton: "撰写邮件", to: "收件人", subject: "主题", attach: "添加附件", saveDraft: "保存草稿", saved: "已保存到服务器", send: "发送邮件", loadMore: "加载较早邮件", star: "为邮件加星标", archive: "归档邮件",
    attachmentReady: "1 个附件已就绪", reply: "回复", mailboxes: "邮箱", share: "共享邮箱", memberId: "成员用户 ID", mailboxRole: "邮箱角色", sharing: "管理共享",
    storageTitle: "基础设施", kvActive: "KV 存储正在使用", kvHealthy: "KV 正常", verifyR2: "验证 R2 写入访问", signOut: "退出登录", accountEmail: "新登录邮箱", currentPassword: "当前密码", updateEmail: "更新登录邮箱", notFound: "未找到此页面", forbidden: "您无权访问此区域",
    cloudflareTitle: "Cloudflare 邮件", controlPlane: "连接控制平面", domainHeading: "Email Routing 域名", brevo: "连接 Brevo",
    preferences: "语言与地区", language: "语言", english: "English", chinese: "简体中文", administration: "管理", users: "用户", create: "创建", emailField: "邮箱地址", displayName: "显示名称", passwordField: "临时密码", roleIds: "角色 ID（以逗号分隔）",
  },
};

export function copyFor(locale: LocaleFixture["code"]): Record<string, string> {
  return locale === "zh-CN" ? copy["zh-CN"] : copy.en;
}

function projectLocale(name: string): LocaleFixture["code"] {
  if (name === "zh-CN") return "zh-CN";
  if (name.startsWith("rtl-")) return "ar-XB";
  return "en";
}

export function seedLocalePreference(
  locale: LocaleFixture["code"],
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
) {
  if (storage.getItem("unimailbox.locale") === null) {
    storage.setItem("unimailbox.locale", locale);
  }
}

export async function initializeProjectLocale(
  context: Pick<BrowserContext, "addInitScript">,
  locale: LocaleFixture["code"],
) {
  await context.addInitScript(seedLocalePreference, locale);
}

export function attachmentReadyPattern(locale: LocaleFixture["code"]) {
  return locale === "zh-CN"
    ? /^1 个附件已就绪$/u
    : /^1 attachment(?:s|\(s\))? ready$/u;
}

export const test = base.extend<{ uiLocale: LocaleFixture }>({
  context: async ({ context }, use, testInfo) => {
    await initializeProjectLocale(context, projectLocale(testInfo.project.name));
    await use(context);
  },
  uiLocale: [
    async ({}, use, testInfo) => {
      const code = projectLocale(testInfo.project.name);
      await use({ code, copy: copyFor(code) });
    },
    { auto: true },
  ],
});

export { expect };

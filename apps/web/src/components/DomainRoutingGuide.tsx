import { ArrowUpRight } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { BidiText } from "./BidiText";

interface DomainRoutingGuideProps {
  dashboardUrl: string;
  domainName: string;
}

/** Guides dashboard-assisted installs through the Cloudflare-owned steps. */
export function DomainRoutingGuide({
  dashboardUrl,
  domainName,
}: DomainRoutingGuideProps) {
  const { t } = useTranslation("settings");

  return (
    <div className="operator-instruction domain-routing-guide">
      <h3>{t("cloudflare.manualRoutingHeading")}</h3>
      <p>
        <Trans
          components={{ name: <BidiText kind="identifier" /> }}
          i18nKey="cloudflare.manualRoutingIntro"
          ns="settings"
          values={{ name: domainName }}
        />
      </p>
      <ol>
        <li>
          <Trans
            components={{ name: <BidiText kind="identifier" /> }}
            i18nKey="cloudflare.manualRoutingOnboard"
            ns="settings"
            values={{ name: domainName }}
          />
        </li>
        <li>{t("cloudflare.manualRoutingDns")}</li>
        <li>
          <Trans
            components={{ worker: <code /> }}
            i18nKey="cloudflare.manualRoutingCatchAll"
            ns="settings"
          />
        </li>
      </ol>
      <a
        className="button secondary"
        href={dashboardUrl}
        rel="noreferrer"
        target="_blank"
      >
        {t("cloudflare.openEmailRouting")}
        <ArrowUpRight aria-hidden="true" />
      </a>
      <p>{t("cloudflare.manualRoutingReturn")}</p>
    </div>
  );
}

export function patchSocialExport(source, replaceRequired) {
  let patched = source;

  const toastImport = 'import { toast } from "../lib/toast.js";';
  const socialImport = `${toastImport}\nimport { SocialExportPanel } from "./SocialExportPanel.js";`;
  if (!patched.includes('from "./SocialExportPanel.js"')) {
    patched = replaceRequired(patched, toastImport, socialImport, "Social export panel import");
  }

  const finalVideoLink = '<a className="btn primary" href={session.renderUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 12 }}>Open final video</a>';
  const finalVideoWithSocial = `${finalVideoLink}\n                  <SocialExportPanel videoUrl={session.renderUrl} projectId={projectId ?? songId} projectName={projectName || cleanTitle(songFilename)} />`;
  if (!patched.includes("<SocialExportPanel videoUrl={session.renderUrl}")) {
    patched = replaceRequired(patched, finalVideoLink, finalVideoWithSocial, "Social exports below final render");
  }

  return patched;
}

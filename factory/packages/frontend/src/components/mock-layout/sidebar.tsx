import { memo, useState } from "react";
import { useStyletron } from "baseui";
import { LabelSmall, LabelXSmall } from "baseui/typography";
import { ChevronDown, ChevronUp, CloudUpload, GitPullRequestDraft, ListChecks, Plus } from "lucide-react";

import { formatRelativeAge, type Handoff, type ProjectSection } from "./view-model";
import { ContextMenuOverlay, HandoffIndicator, PanelHeaderBar, SPanel, ScrollBody, useContextMenu } from "./ui";

const PROJECT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

function projectInitial(label: string): string {
  const parts = label.split("/");
  const name = parts[parts.length - 1] ?? label;
  return name.charAt(0).toUpperCase();
}

function projectIconColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!;
}

export const Sidebar = memo(function Sidebar({
  projects,
  activeId,
  onSelect,
  onCreate,
  onMarkUnread,
  onRenameHandoff,
  onRenameBranch,
}: {
  projects: ProjectSection[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onMarkUnread: (id: string) => void;
  onRenameHandoff: (id: string) => void;
  onRenameBranch: (id: string) => void;
}) {
  const [css, theme] = useStyletron();
  const contextMenu = useContextMenu();
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  return (
    <SPanel>
      <style>{`
        [data-project-header]:hover [data-chevron] {
          display: inline-flex !important;
        }
        [data-project-header]:hover [data-project-icon] {
          display: none !important;
        }
      `}</style>
      <PanelHeaderBar>
        <LabelSmall
          color={theme.colors.contentPrimary}
          $style={{ fontWeight: 600, flex: 1, fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
        >
          <ListChecks size={14} />
          Tasks
        </LabelSmall>
        <button
          onClick={onCreate}
          className={css({
            all: "unset",
            width: "24px",
            height: "24px",
            borderRadius: "4px",
            backgroundColor: "#ff4f00",
            color: "#ffffff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 200ms ease",
            ":hover": { backgroundColor: "#ff6a00" },
          })}
        >
          <Plus size={14} />
        </button>
      </PanelHeaderBar>
      <ScrollBody>
        <div className={css({ padding: "8px", display: "flex", flexDirection: "column", gap: "4px" })}>
          {projects.map((project) => {
            const isCollapsed = collapsedProjects[project.id] === true;

            return (
              <div key={project.id} className={css({ display: "flex", flexDirection: "column", gap: "4px" })}>
                <div
                  onClick={() =>
                    setCollapsedProjects((current) => ({
                      ...current,
                      [project.id]: !current[project.id],
                    }))
                  }
                  data-project-header
                  className={css({
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 8px 4px",
                    gap: "8px",
                    cursor: "pointer",
                    userSelect: "none",
                    ":hover": { opacity: 0.8 },
                  })}
                >
                  <div className={css({ display: "flex", alignItems: "center", gap: "4px", overflow: "hidden" })}>
                    <div className={css({ position: "relative", width: "14px", height: "14px", flexShrink: 0 })}>
                      <span
                        className={css({
                          position: "absolute",
                          inset: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "3px",
                          fontSize: "9px",
                          fontWeight: 700,
                          lineHeight: 1,
                          color: "#fff",
                          backgroundColor: projectIconColor(project.label),
                        })}
                        data-project-icon
                      >
                        {projectInitial(project.label)}
                      </span>
                      <span className={css({ position: "absolute", inset: 0, display: "none", alignItems: "center", justifyContent: "center" })} data-chevron>
                        {isCollapsed ? (
                          <ChevronDown size={12} color={theme.colors.contentTertiary} />
                        ) : (
                          <ChevronUp size={12} color={theme.colors.contentTertiary} />
                        )}
                      </span>
                    </div>
                    <LabelSmall
                      color={theme.colors.contentSecondary}
                      $style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {project.label}
                    </LabelSmall>
                  </div>
                  <LabelXSmall color={theme.colors.contentTertiary}>
                    {formatRelativeAge(project.updatedAtMs)}
                  </LabelXSmall>
                </div>

                {!isCollapsed && project.handoffs.map((handoff) => {
                  const isActive = handoff.id === activeId;
                  const isDim = handoff.status === "archived";
                  const isRunning = handoff.tabs.some((tab) => tab.status === "running");
                  const hasUnread = handoff.tabs.some((tab) => tab.unread);
                  const isDraft = handoff.pullRequest == null || handoff.pullRequest.status === "draft";
                  const totalAdded = handoff.fileChanges.reduce((sum, file) => sum + file.added, 0);
                  const totalRemoved = handoff.fileChanges.reduce((sum, file) => sum + file.removed, 0);
                  const hasDiffs = totalAdded > 0 || totalRemoved > 0;

                  return (
                    <div
                      key={handoff.id}
                      onClick={() => onSelect(handoff.id)}
                      onContextMenu={(event) =>
                        contextMenu.open(event, [
                          { label: "Rename task", onClick: () => onRenameHandoff(handoff.id) },
                          { label: "Rename branch", onClick: () => onRenameBranch(handoff.id) },
                          { label: "Mark as unread", onClick: () => onMarkUnread(handoff.id) },
                        ])
                      }
                      className={css({
                        padding: "12px",
                        borderRadius: "8px",
                        border: "1px solid transparent",
                        backgroundColor: isActive ? "rgba(255, 255, 255, 0.06)" : "transparent",
                        cursor: "pointer",
                        transition: "all 200ms ease",
                        ":hover": {
                          backgroundColor: "rgba(255, 255, 255, 0.06)",
                        },
                      })}
                    >
                      <div className={css({ display: "flex", alignItems: "center", gap: "8px" })}>
                        <div
                          className={css({
                            width: "14px",
                            minWidth: "14px",
                            height: "14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          })}
                        >
                          <HandoffIndicator isRunning={isRunning} hasUnread={hasUnread} isDraft={isDraft} />
                        </div>
                        <LabelSmall
                          $style={{
                            fontWeight: 600,
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          color={isDim ? theme.colors.contentSecondary : theme.colors.contentPrimary}
                        >
                          {handoff.title}
                        </LabelSmall>
                        {hasDiffs ? (
                          <div className={css({ display: "flex", gap: "4px", flexShrink: 0 })}>
                            <span className={css({ fontSize: "11px", color: "#7ee787" })}>+{totalAdded}</span>
                            <span className={css({ fontSize: "11px", color: "#ffa198" })}>-{totalRemoved}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className={css({ display: "flex", alignItems: "center", marginTop: "4px", gap: "6px" })}>
                        <LabelXSmall
                          color={theme.colors.contentTertiary}
                          $style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flexShrink: 1,
                          }}
                        >
                          {handoff.repoName}
                        </LabelXSmall>
                        {handoff.pullRequest != null ? (
                          <span className={css({ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 })}>
                            <LabelXSmall color={theme.colors.contentSecondary} $style={{ fontWeight: 600 }}>
                              #{handoff.pullRequest.number}
                            </LabelXSmall>
                            {handoff.pullRequest.status === "draft" ? <CloudUpload size={11} color="#ff4f00" /> : null}
                          </span>
                        ) : (
                          <GitPullRequestDraft size={11} color={theme.colors.contentTertiary} />
                        )}
                        <LabelXSmall color={theme.colors.contentTertiary} $style={{ marginLeft: "auto", flexShrink: 0 }}>
                          {formatRelativeAge(handoff.updatedAtMs)}
                        </LabelXSmall>
                      </div>
                    </div>
                  );
                })}

              </div>
            );
          })}
        </div>
      </ScrollBody>
      {contextMenu.menu ? <ContextMenuOverlay menu={contextMenu.menu} onClose={contextMenu.close} /> : null}
    </SPanel>
  );
});

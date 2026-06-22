import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash, ChatBubble, Pencil, X } from "../../assets/icons";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { PROFILE_COLORS } from "../../../../shared/profileColors";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import { useI18n } from "../../components/useI18n";

interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
  color?: string;
  avatar?: string | null;
}

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function Agents({
  activeProfile,
  onSelectProfile,
  onChatWith,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Name of the profile whose appearance modal is open (null = closed).
  const [editingName, setEditingName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live view of the profile being edited, so the modal reflects updates.
  const editingProfile = editingName
    ? (profiles.find((p) => p.name === editingName) ?? null)
    : null;

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
  }, []);

  async function handlePickColor(name: string, color: string): Promise<void> {
    setProfiles((cur) =>
      cur.map((p) => (p.name === name ? { ...p, color } : p)),
    );
    const result = await window.hermesAPI.setProfileColor(name, color);
    if (!result.success) setError(result.error || t("agents.appearanceFailed"));
    loadProfiles();
  }

  function triggerUpload(): void {
    fileInputRef.current?.click();
  }

  async function handleAvatarFile(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    const name = editingName;
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !name) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const result = await window.hermesAPI.setProfileAvatar(name, dataUrl);
      if (!result.success)
        setError(result.error || t("agents.uploadImageFailed"));
    } catch {
      setError(t("agents.uploadImageFailed"));
    }
    loadProfiles();
  }

  async function handleRemoveAvatar(name: string): Promise<void> {
    const result = await window.hermesAPI.removeProfileAvatar(name);
    if (!result.success) setError(result.error || t("agents.appearanceFailed"));
    loadProfiles();
  }

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  async function handleCreate(): Promise<void> {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(name, cloneConfig);
    setCreating(false);
    if (result.success) {
      setShowCreate(false);
      setNewName("");
    } else {
      setError(result.error || t("agents.createFailed"));
    }
    loadProfiles();
  }

  async function handleDelete(name: string): Promise<void> {
    const previousProfiles = profiles;
    setConfirmDelete(null);
    setError("");
    setProfiles((current) => current.filter((p) => p.name !== name));

    const result = await window.hermesAPI.deleteProfile(name);
    if (result.success) {
      if (activeProfile === name) onSelectProfile("default");
      loadProfiles();
    } else {
      setProfiles(previousProfiles);
      setError(result.error || t("agents.deleteFailed"));
    }
  }

  async function handleSelect(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onSelectProfile(name);
    loadProfiles();
  }

  // "Chat" button — make the agent active (starts its gateway) then open a
  // conversation with it. The only path here that starts a chat.
  async function handleChatWith(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onChatWith(name);
    loadProfiles();
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.title")}</h2>
          <p className="agents-subtitle">{t("agents.subtitle")}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} />
          {t("agents.newAgent")}
        </button>
      </div>

      {showCreate && (
        <div className="agents-create">
          <input
            className="input"
            placeholder={t("agents.namePlaceholder")}
            value={newName}
            onChange={(e) => {
              const v = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "");
              setNewName(v);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={cloneConfig}
              onChange={(e) => setCloneConfig(e.target.checked)}
            />
            <span>{t("agents.cloneConfig")}</span>
          </label>
          {error && <div className="agents-create-error">{error}</div>}
          <div className="agents-create-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t("agents.creating") : t("agents.create")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowCreate(false);
                setError("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {!showCreate && error && (
        <div className="agents-create-error">{error}</div>
      )}

      <div className="agents-grid">
        {profiles.map((p) => (
          <div
            key={p.name}
            className={`agents-card ${activeProfile === p.name ? "active" : ""}`}
            onClick={() => handleSelect(p.name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSelect(p.name);
            }}
          >
            <button
              type="button"
              className="agents-card-edit"
              title={t("agents.editAppearance")}
              aria-label={t("agents.editAppearance")}
              onClick={(e) => {
                e.stopPropagation();
                setError("");
                setEditingName(p.name);
              }}
            >
              <Pencil size={14} />
            </button>
            <div className="agents-card-header">
              <ProfileAvatar
                name={p.name}
                color={p.color}
                avatar={p.avatar}
                size={36}
              />
              <div className="agents-card-info">
                <div className="agents-card-name">{p.name}</div>
                <div className="agents-card-provider">
                  {providerLabel(p.provider)}
                </div>
              </div>
            </div>
            <div className="agents-card-model">
              {p.model ? p.model.split("/").pop() : t("agents.noModel")}
            </div>
            <div className="agents-card-stats">
              <span>{t("agents.skillsCount", { count: p.skillCount })}</span>
              <span className="agents-card-dot" />
              {p.gatewayRunning ? (
                <span className="agents-card-gateway-on">
                  {t("agents.gatewayRunning")}
                </span>
              ) : (
                <span>{t("agents.gatewayOff")}</span>
              )}
            </div>
            <div className="agents-card-footer">
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleChatWith(p.name);
                }}
              >
                <ChatBubble size={13} />
                {t("agents.chat")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingProfile && (
        <div
          className="agents-appearance-overlay"
          onClick={() => setEditingName(null)}
        >
          <div
            className="agents-appearance-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="agents-appearance-modal-header">
              <span className="agents-appearance-modal-title">
                {t("agents.editAppearanceFor", { name: editingProfile.name })}
              </span>
              <button
                className="agents-appearance-modal-close"
                onClick={() => setEditingName(null)}
                aria-label={t("common.cancel")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="agents-appearance-modal-body">
              <div className="agents-appearance-preview">
                <ProfileAvatar
                  name={editingProfile.name}
                  color={editingProfile.color}
                  avatar={editingProfile.avatar}
                  size={64}
                />
                <div className="agents-appearance-image-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={triggerUpload}
                  >
                    {t("agents.uploadImage")}
                  </button>
                  {editingProfile.avatar && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRemoveAvatar(editingProfile.name)}
                    >
                      {t("agents.removeImage")}
                    </button>
                  )}
                </div>
              </div>

              <div className="agents-appearance-section">
                <span className="agents-appearance-label">
                  {t("agents.color")}
                </span>
                <div className="agents-appearance-swatches">
                  {PROFILE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`agents-appearance-swatch ${
                        (editingProfile.color || "").toLowerCase() ===
                        c.toLowerCase()
                          ? "active"
                          : ""
                      }`}
                      style={{ background: c }}
                      title={c}
                      aria-label={c}
                      onClick={() => handlePickColor(editingProfile.name, c)}
                    />
                  ))}
                </div>
              </div>

              {!editingProfile.isDefault && (
                <div className="agents-appearance-danger">
                  <span className="agents-appearance-label agents-appearance-danger-label">
                    {t("agents.dangerZone")}
                  </span>
                  <p className="agents-appearance-danger-info">
                    {t("agents.deleteProfileInfo")}
                  </p>
                  {confirmDelete === editingProfile.name ? (
                    <div className="agents-appearance-danger-confirm">
                      <span>{t("agents.deleteProfileConfirm")}</span>
                      <div className="agents-appearance-image-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(editingProfile.name)}
                        >
                          {t("agents.deleteProfile")}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setConfirmDelete(null)}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn btn-danger-ghost btn-sm"
                      onClick={() => setConfirmDelete(editingProfile.name)}
                    >
                      <Trash size={13} />
                      {t("agents.deleteProfile")}
                    </button>
                  )}
                </div>
              )}

              {error && <div className="agents-create-error">{error}</div>}
            </div>

            <div className="agents-appearance-modal-footer">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setEditingName(null)}
              >
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleAvatarFile}
      />
    </div>
  );
}

export default Agents;

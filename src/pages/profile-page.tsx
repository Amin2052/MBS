import { useEffect, useMemo, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import { ArrowLeft, Pencil, UserCircle, KeyRound } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import {
  getMyProfilePhoto,
  pickProfilePhoto,
  saveProfilePhoto,
  removeProfilePhoto,
  notifyProfilePhotoChanged
} from "@/services/auth-service";

import "@/pages/settings/settings-category.css";
import "./profile.css";


type ProfileDraft = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  designation: string;
};

function draftFromUser(user: ReturnType<typeof useAuth>["user"]): ProfileDraft {

  return {
    fullName: user?.full_name ?? "",
    username: user?.username ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    designation: user?.designation ?? ""
  };

}


export default function ProfilePage(): JSX.Element {

  const navigate = useNavigate();
  const { t } = useLanguage();

  const { user, updateProfile, hasPermission } = useAuth();

  // Designation/Job Title is only editable by the Owner, or anyone
  // holding employees.edit (the app's existing RBAC equivalent of
  // "HR") -- same rule enforced again, server-side, in main.ts's
  // auth:updateProfile handler. This client-side check is UX only.
  const canEditDesignation =
    user?.user_type === "owner" || hasPermission("employees.edit");

  // PHASE 10 UI AUDIT FIX: this used to be a hardcoded English-only
  // map, then was pointed at "userManagement.owner/administrator/
  // employee" -- but "userManagement" in en.ts/bn.ts/ar.ts is a flat
  // string (the settings nav label), not an object with those
  // children, so t() couldn't resolve it and returned the raw key
  // literally (same root cause fixed in topbar.tsx). The real,
  // correctly-translated namespace (used by the User Management
  // settings page) is "settingsUserManagement".
  const roleLabel: Record<string, string> = {
    owner: t("settingsUserManagement.owner"),
    administrator: t("settingsUserManagement.administrator"),
    employee: t("settingsUserManagement.employee")
  };


  // ---- Edit Profile ----

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromUser(user));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  function startEditing(): void {
    setDraft(draftFromUser(user));
    setProfileError(null);
    setEditing(true);
  }

  // Discard Changes: exits edit mode and restores the original values --
  // no update-profile call is made, so nothing is written to the database.
  function discardChanges(): void {
    setDraft(draftFromUser(user));
    setEditing(false);
    setProfileError(null);
    setPhotoMenuOpen(false);
    setPhotoError(null);
  }

  const savedDraft = useMemo(() => draftFromUser(user), [user]);

  // Save is only actionable once the draft actually differs from the
  // saved values.
  const hasProfileChanges = useMemo(
    () =>
      draft.fullName.trim() !== savedDraft.fullName ||
      draft.username.trim() !== savedDraft.username ||
      draft.email.trim() !== savedDraft.email ||
      draft.phone.trim() !== savedDraft.phone ||
      (canEditDesignation && draft.designation.trim() !== savedDraft.designation),
    [draft, savedDraft, canEditDesignation]
  );

  async function saveChanges(): Promise<void> {

    if (!hasProfileChanges) {
      return;
    }

    if (!draft.username.trim()) {
      setProfileError(t("profile.usernameEmpty"));
      return;
    }

    setSavingProfile(true);
    setProfileError(null);

    try {

      const result = await updateProfile({
        username: draft.username.trim(),
        fullName: draft.fullName,
        email: draft.email,
        phone: draft.phone,
        // Only send designation if this user is actually allowed to
        // change it -- keeps the request honest even though the
        // server re-checks this itself regardless.
        ...(canEditDesignation ? { designation: draft.designation } : {})
      });

      if (result.success) {
        setEditing(false);
        setPhotoMenuOpen(false);
      }
      else {
        setProfileError(result.error ?? t("profile.updateFailed"));
      }

    }
    finally {

      setSavingProfile(false);

    }

  }


  // ---- Profile Picture (unchanged architecture) ----

  const [photo, setPhoto] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);

  useEffect(() => {

    let cancelled = false;

    getMyProfilePhoto()
      .then(dataUrl => {
        if (!cancelled) {
          setPhoto(dataUrl);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPhotoLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };

  }, []);

  useEffect(() => {

    function handleOutsideClick(event: MouseEvent) {

      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setPhotoMenuOpen(false);
      }

    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };

  }, []);

  async function handleChangePhoto(): Promise<void> {

    setPhotoMenuOpen(false);
    setPhotoError(null);

    const picked = await pickProfilePhoto();

    if (!picked) {
      return;
    }

    setPhotoBusy(true);

    try {

      const result = await saveProfilePhoto(picked.dataUrl);

      if (result.success) {
        setPhoto(picked.dataUrl);
        notifyProfilePhotoChanged(picked.dataUrl);
      }
      else {
        setPhotoError(t("profile.updateFailed"));
      }

    }
    catch {

      setPhotoError(t("profile.updateFailed"));

    }
    finally {

      setPhotoBusy(false);

    }

  }

  async function handleRemovePhoto(): Promise<void> {

    setPhotoMenuOpen(false);
    setPhotoError(null);
    setPhotoBusy(true);

    try {

      const result = await removeProfilePhoto();

      if (result.success) {
        setPhoto(null);
        notifyProfilePhotoChanged(null);
      }
      else {
        setPhotoError(t("profile.updateFailed"));
      }

    }
    catch {

      setPhotoError(t("profile.updateFailed"));

    }
    finally {

      setPhotoBusy(false);

    }

  }


  function updateDraft<K extends keyof ProfileDraft>(key: K, value: string): void {
    setDraft(prev => ({ ...prev, [key]: value }));
  }


  return (

    <div className="profile-page">


      <button
        type="button"
        className="profile-back-link"
        onClick={() => navigate("/")}
      >
        <ArrowLeft size={16} />
        {t("profile.backToDashboard")}
      </button>


      <div className="profile-header">

        <h1>{t("profile.title")}</h1>

        <p>
          {t("profile.subtitle")}
        </p>

      </div>



      <div className="profile-card">


        <div className="profile-avatar-wrapper" ref={menuRef}>

          <div className="profile-avatar">

            {
              photo ?
              <img src={photo} alt={t("profile.profilePhotoAlt")} />
              :
              <UserCircle size={64}/>
            }

          </div>

          {editing && (
          <button
            type="button"
            className="profile-avatar-edit-btn"
            onClick={() => setPhotoMenuOpen(prev => !prev)}
            disabled={photoLoading || photoBusy}
            title={photo ? t("profile.changeProfilePicture") : t("profile.addProfilePicture")}
          >
            <Pencil size={12} />
          </button>
          )}

          {photoMenuOpen ? (

            <div className="profile-avatar-menu">

              <button type="button" onClick={handleChangePhoto}>
                {photo ? t("profile.changePhoto") : t("profile.addPhoto")}
              </button>

              {photo ? (
                <button type="button" onClick={handleRemovePhoto}>
                  {t("profile.removePhoto")}
                </button>
              ) : null}

            </div>

          ) : null}

        </div>

        {photoError ? (
          <p className="settings-error-message" role="alert" aria-live="assertive">{photoError}</p>
        ) : null}


        <div className="profile-info">


          {editing ? (

            <>

              <div className="profile-edit-form">

                <div className="form-group">
                  <label htmlFor="pf-fullname">{t("profile.fullNameLabel")}</label>
                  <input
                    id="pf-fullname"
                    type="text"
                    dir="ltr"
                    value={draft.fullName}
                    onChange={e => updateDraft("fullName", e.target.value)}
                    disabled={savingProfile}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="pf-username">{t("login.usernameLabel")}</label>
                  <input
                    id="pf-username"
                    type="text"
                    dir="ltr"
                    value={draft.username}
                    onChange={e => updateDraft("username", e.target.value)}
                    disabled={savingProfile}
                  />
                </div>

                <div className="form-grid">

                  <div className="form-group">
                    <label htmlFor="pf-email">{t("profile.emailLabel")}</label>
                    <input
                      id="pf-email"
                      type="email"
                      dir="ltr"
                      value={draft.email}
                      onChange={e => updateDraft("email", e.target.value)}
                      disabled={savingProfile}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="pf-phone">{t("profile.phoneLabel")}</label>
                    <input
                      id="pf-phone"
                      type="tel"
                      dir="ltr"
                      value={draft.phone}
                      onChange={e => updateDraft("phone", e.target.value)}
                      disabled={savingProfile}
                    />
                  </div>

                </div>

                <div className="form-group">
                  <label>{t("profile.designationLabel")}</label>
                  {canEditDesignation ? (
                    <input
                      type="text"
                      dir="ltr"
                      value={draft.designation}
                      onChange={e => updateDraft("designation", e.target.value)}
                      disabled={savingProfile}
                    />
                  ) : (
                    <div
                      className="profile-readonly-value"
                      title={t("profile.designationRestrictedNote")}
                    >
                      {draft.designation || "-"}
                    </div>
                  )}
                </div>

              </div>

              {profileError ? (
                <p className="settings-error-message" role="alert" aria-live="assertive">{profileError}</p>
              ) : null}

              <div className="settings-actions">

                <button
                  type="button"
                  className="save-settings"
                  onClick={saveChanges}
                  disabled={savingProfile || !hasProfileChanges}
                >
                  {t("profile.saveChanges")}
                </button>

                <button
                  type="button"
                  className="reset-settings"
                  onClick={discardChanges}
                  disabled={savingProfile}
                >
                  {t("profile.discardChanges")}
                </button>

              </div>

            </>

          ) : (

            <>

              <div className="profile-row">
                <span>{t("profile.fullNameLabel")}</span>
                <strong>{user?.full_name || "-"}</strong>
              </div>

              <div className="profile-row">
                <span>{t("login.usernameLabel")}</span>
                <strong>{user?.username ?? "-"}</strong>
              </div>

              <div className="profile-row">
                <span>{t("profile.emailLabel")}</span>
                <strong>{user?.email || "-"}</strong>
              </div>

              <div className="profile-row">
                <span>{t("profile.phoneLabel")}</span>
                <strong>{user?.phone || "-"}</strong>
              </div>

              <div className="profile-row">
                <span>{t("profile.designationLabel")}</span>
                <strong>{user?.designation || "-"}</strong>
              </div>

              <div className="profile-row">
                <span>{t("profile.roleLabel")}</span>
                <strong>
                  {user ? roleLabel[user.user_type] ?? user.user_type : "-"}
                </strong>
              </div>

              <div className="profile-row">
                <span>{t("profile.statusLabel")}</span>
                <strong className="active-status">{t("profile.statusActive")}</strong>
              </div>

              <div className="profile-edit-actions">

                <button
                  type="button"
                  className="profile-edit-trigger profile-action-btn"
                  onClick={startEditing}
                >
                  <Pencil size={14} />
                  {t("profile.editProfile")}
                </button>

                <button
                  type="button"
                  className="profile-edit-discard-btn profile-action-btn"
                  onClick={() => navigate("/change-password")}
                >
                  <KeyRound size={14} />
                  {t("changePassword.title")}
                </button>

              </div>

            </>

          )}


        </div>


      </div>


    </div>

  );

}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, Eye, EyeOff, ArrowLeft } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import "./change-password.css";


export default function ChangePasswordPage(): JSX.Element {

  const navigate = useNavigate();
  const { changePassword } = useAuth();
  const { t } = useLanguage();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(){

    if (newPassword.length < 8) {
      setError(t("changePassword.passwordTooShort"));
      return;
    }

    if(newPassword !== confirmPassword){

      setError(t("changePassword.passwordsDoNotMatch"));

      return;

    }

    setSubmitting(true);
    setError(null);

    try {

      const result = await changePassword(currentPassword, newPassword);

      if (result.success) {

        navigate("/");

      } else {

        setError(result.error ?? t("changePassword.changeFailed"));

      }

    }
    catch {

      setError(t("changePassword.changeFailed"));

    }
    finally {

      setSubmitting(false);

    }

  }



  return (

    <div className="change-password-page">


      <button
        type="button"
        className="change-password-back-link"
        onClick={() => navigate("/")}
      >
        <ArrowLeft size={16} />
        {t("changePassword.backToDashboard")}
      </button>


      <div className="change-password-header">

        <h1>
          {t("changePassword.title")}
        </h1>

        <p>
          {t("changePassword.subtitle")}
        </p>

      </div>




      <div className="change-password-card">


        <div className="change-password-icon">

          <LockKeyhole size={34}/>

        </div>



        <div className="password-form">



          <div className="password-field">

            <label>
              {t("changePassword.currentPassword")}
            </label>


            <div className="password-input">

              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e)=>setCurrentPassword(e.target.value)}
              />


              <button
                type="button"
                onClick={()=>setShowCurrent(!showCurrent)}
              >

                {
                  showCurrent
                  ? <EyeOff size={18}/>
                  : <Eye size={18}/>
                }

              </button>


            </div>


          </div>





          <div className="password-field">

            <label>
              {t("changePassword.newPassword")}
            </label>


            <div className="password-input">

              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e)=>setNewPassword(e.target.value)}
              />


              <button
                type="button"
                onClick={()=>setShowNew(!showNew)}
              >

                {
                  showNew
                  ? <EyeOff size={18}/>
                  : <Eye size={18}/>
                }

              </button>


            </div>


          </div>





          <div className="password-field">

            <label>
              {t("changePassword.confirmPassword")}
            </label>


            <div className="password-input">

              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e)=>setConfirmPassword(e.target.value)}
              />


              <button
                type="button"
                onClick={()=>setShowConfirm(!showConfirm)}
              >

                {
                  showConfirm
                  ? <EyeOff size={18}/>
                  : <Eye size={18}/>
                }

              </button>


            </div>


          </div>





          {error && (
            <p className="change-password-error">{error}</p>
          )}

          <button
            className="save-password-btn"
            onClick={handleSubmit}
            disabled={submitting}
          >

            {submitting ? t("changePassword.saving") : t("changePassword.savePassword")}

          </button>



        </div>


      </div>



    </div>

  );

}
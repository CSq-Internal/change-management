# Google Drive Document Storage Setup

1. In the CSquared Google Cloud project, enable the **Google Drive API**.
2. Create a **service account**; generate a **JSON key**. Store the JSON as the
   `GOOGLE_SERVICE_ACCOUNT_KEY` env var (single line). Never commit it.
3. In Google Drive, create a **private Shared Drive** named "Change Management" and a
   root folder inside it. Copy the Shared Drive ID → `GDRIVE_SHARED_DRIVE_ID`, and the
   root folder ID → `GDRIVE_ROOT_FOLDER_ID`.
4. Add the service account's email as a **Content Manager** of the Shared Drive.
5. Verify: upload a document through a draft change request and confirm it appears under
   `OpCo / Year / CHG-#### — Title / NN_Section/` in the Shared Drive.

Access is service-account-only; no human or end-user OAuth is used, and no shareable
links are issued (ISO 27001:2022 A.8.3 / A.8.12).

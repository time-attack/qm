---
name: import-passwords
description: Import website and generated passwords from the Mac Passwords app into the signed-in user's QM keychain. Use when someone asks to import, move, or sync passwords from Apple Passwords, iCloud Passwords, or the Passwords app.
---

# Import passwords from the Mac Passwords app

This exists only in the QM desktop app on a Mac, on the Keychain page. The control is the **Import from Passwords** card. There is no chat command, Slack action, or API you can call to read the Passwords app. You never ask for, see, or type their passwords.

When someone wants those logins in QM:

1. They open the QM desktop app on their Mac. A browser tab and Slack cannot do this.
2. They open Keychain.
3. They choose **Import from Passwords**.
4. Passwords opens. They choose **Export All Items to App**, then choose **QM**.
5. Website logins and generated passwords are saved to their keychain. Passkeys, cards, notes, and one-time codes stay in Passwords.

Passwords only lists QM when this Mac app is signed with Apple's AutoFill Credential Provider entitlement. An ad-hoc or unsigned build is registered locally but omitted from that list. Do not invent a CSV upload, a paste box, or another export path, and do not ask them to paste a password.

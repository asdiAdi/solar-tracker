# Solar Tracker ☀️

Simple PWA Solar Tracking app to track and estimate expenses.

## Data

- Battery Percentage
- Current Consumption and Generation
- Daily, Monthly and Yearly data views
- Cost Calculations
- Forecast Cost Calculations

## Run

```
npm install
npm run dev
npm run build    # -> dist/ static
npm run preview
```

### VAPID keys

Before deploying, generate a key pair and upload it to SSM:

```
npm run vapid:keys
```

Run the printed `aws ssm put-parameter` commands for the stages you deploy. The
public key is a String and the private key is a SecureString under
`/solar-tracker/backend/<stage>/`.

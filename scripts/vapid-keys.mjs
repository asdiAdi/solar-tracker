import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("Upload these VAPID keys to SSM before deploying:\n");
for (const stage of ["dev", "prod"]) {
  const prefix = `/solar-tracker/backend/${stage}`;
  console.log(
    `aws ssm put-parameter --name ${prefix}/VAPID_PUBLIC_KEY --type String --value "${keys.publicKey}" --overwrite`,
  );
  console.log(
    `aws ssm put-parameter --name ${prefix}/VAPID_PRIVATE_KEY --type SecureString --value "${keys.privateKey}" --overwrite\n`,
  );
}

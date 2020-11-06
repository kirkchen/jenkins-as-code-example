import { readFileSync } from 'fs'
import { join } from 'path'
import { MachineImage, WindowsVersion } from '@aws-cdk/aws-ec2'
import {
  CfnInstanceProfile,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from '@aws-cdk/aws-iam'
import {
  CfnComponent,
  CfnImagePipeline,
  CfnImageRecipe,
  CfnInfrastructureConfiguration
} from '@aws-cdk/aws-imagebuilder'
import { Bucket } from '@aws-cdk/aws-s3'
import { Construct, RemovalPolicy, Stack, StackProps } from '@aws-cdk/core'

export class ImageBuilderStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props)

    const setupWinRMComponent = new CfnComponent(this, 'Setup WinRM', {
      name: 'Setup WinRM',
      platform: 'Windows',
      version: '1.0.0',
      data: readFileSync(
        join(__dirname, '../imageBuilderComponents/setupWinRM.yaml')
      ).toString()
    })

    // new CfnComponent(this, "Enable smb1", {
    //   name: "Enable smb1",
    //   platform: "Windows",
    //   version: "1.0.0",
    //   data: readFileSync(
    //     join(__dirname, "../imageBuilderComponents/enableSmb1.yaml")
    //   ).toString(),
    // });

    const installChocolateyComponent = new CfnComponent(
      this,
      'Install Build Tools',
      {
        name: 'Install Build Tools',
        platform: 'Windows',
        version: '1.0.1',
        data: readFileSync(
          join(__dirname, '../imageBuilderComponents/installBuildTools.yaml')
        ).toString()
      }
    )

    const jenkinsWindowsSlaveRecipe = new CfnImageRecipe(
      this,
      'Jenkins Windows Slave Recipe',
      {
        name: 'Jenkins Windows Slave Recipe',
        version: '1.0.1',
        components: [
          {
            componentArn: setupWinRMComponent.attrArn
          },
          {
            componentArn: installChocolateyComponent.attrArn
          }
        ],
        parentImage: MachineImage.latestWindows(
          WindowsVersion.WINDOWS_SERVER_2016_ENGLISH_FULL_BASE
        ).getImage(this).imageId
      }
    )

    const windowsBuilderRole = new Role(this, 'Windows Builder Role', {
      roleName: 'WindowsBuilderRole',
      assumedBy: new ServicePrincipal('ec2.amazonaws.com')
    })
    windowsBuilderRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    )
    windowsBuilderRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'EC2InstanceProfileForImageBuilder'
      )
    )
    // windowsBuilderRole.addManagedPolicy(
    //   ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
    // );

    const windowsBuilderInstanceProfile = new CfnInstanceProfile(
      this,
      'Windows Builder Instance Profile',
      {
        instanceProfileName: 'WindowsBuilderInstanceProfile',
        roles: [windowsBuilderRole.roleName]
      }
    )

    const bucket = new Bucket(this, 'Windows Image Builder Logs', {
      bucketName: `${this.stackName}-logs`,
      removalPolicy: RemovalPolicy.DESTROY
    })
    bucket.addToResourcePolicy(
      // @ts-ignore
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:*'],
        resources: [bucket.bucketArn, bucket.arnForObjects('*')],
        principals: [windowsBuilderRole]
      })
    )

    const windowsImageBuilderInfraConfig = new CfnInfrastructureConfiguration(
      this,
      'Windows Image Builder',
      {
        name: 'Windows Image Builder',
        instanceTypes: ['t3.xlarge'],
        instanceProfileName: windowsBuilderInstanceProfile.instanceProfileName!,
        logging: {
          s3Logs: {
            s3BucketName: bucket.bucketName,
            s3KeyPrefix: 'windows-image-builder'
          }
        }
      }
    )

    new CfnImagePipeline(this, 'Jenkins Windows Slave', {
      name: 'Jenkins Windows Slave Pipeline',
      imageRecipeArn: jenkinsWindowsSlaveRecipe.attrArn,
      infrastructureConfigurationArn: windowsImageBuilderInfraConfig.attrArn
    })
  }
}

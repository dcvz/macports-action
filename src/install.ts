import * as core from "@actions/core";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import * as exec from "@actions/exec";
import * as path from "path";

// method that returns a positive integer hash code for a string
const hashCode = function (s: string): number {
    let h = 0,
        l = s.length,
        i = 0;
    if (l > 0) while (i < l) h = (h << 5) - h + s.charCodeAt(i++) | 0;
    return h;
}

async function runInner(): Promise<void> {
    const macportsVersion = core.getInput("version");
    const dependencies = JSON.parse(core.getInput("dependencies"));

    // create a version number hash from the version string and the dependencies
    let versionHash = `${hashCode(macportsVersion + dependencies.join(""))}.0.0`;
    core.info(`Version hash: ${versionHash}`);

    let macportsPath = tc.find("macports", versionHash);

    // check it is macos or reject
    if (process.platform !== "darwin") {
        core.setFailed(`Unsupported platform: ${process.platform}`);
    }

    // get OSX version
    let osxVersion = await exec.getExecOutput("sw_vers", ["-productVersion"]);
    let installerSuffix = "-12-Monterey.pkg";

    // detect Catalina, Big Sur, Monterey or Ventura
    if (osxVersion.stdout.startsWith("10.15")) {
        installerSuffix = "-10-Catalina.pkg";
    } else if (osxVersion.stdout.startsWith("11.")) {
        installerSuffix = "-11-BigSur.pkg";
    } else if (osxVersion.stdout.startsWith("12.")) {
        installerSuffix = "-12-Monterey.pkg";
    } else if (osxVersion.stdout.startsWith("13.")) {
        installerSuffix = "-13-Ventura.pkg";
    } else {
        core.setFailed(`Unsupported OSX version: ${osxVersion.stdout}`);
    }

    // install if not present
    if (!macportsPath) {
        core.startGroup(`Install MacPorts`);
        let filename = "MacPorts-" + macportsVersion + installerSuffix;
        let downloadUrl = "https://github.com/macports/macports-base/releases/download/v" + macportsVersion + "/" + filename;
        const downloadPath = await tc.downloadTool(downloadUrl);

        let tempDir = process.env["RUNNER_TEMPDIRECTORY"] || path.join("/Users", "runner", "temp", "temp_" + Math.floor(Math.random() * 2000000000));
        await io.mkdirP(tempDir);
        await io.cp(downloadPath, path.join(tempDir, filename));

        let exitCode = await exec.exec("sudo /usr/sbin/installer", [
            "-pkg",
            path.join(tempDir, filename),
            "-target",
            "/"
        ]);

        if (exitCode != 0) {
            core.setFailed(`Could not install MacPorts. Exit code = ${exitCode}`);
        }

        core.info(await io.which("port"));
        core.endGroup();

        core.addPath("/opt/local/bin:/opt/local/sbin");

        // install dependencies
        core.startGroup(`Install dependencies`);
        await exec.exec("sudo port", ["selfupdate"]);
        await exec.exec("sudo port", ["install", ...dependencies]);
        core.endGroup();

        await tc.cacheDir("/opt/local", "macports", versionHash);
    } else {
        core.info(`Using cached MacPorts installation`);
        core.info(`MacPorts path: ${macportsPath}`);
        core.addPath(`${path.join(macportsPath, "bin")}:${path.join(macportsPath, "sbin")}`);
    }
}

async function run(): Promise<void> {
    try {
        await runInner();
    } catch (error) {
        core.setFailed(`Restoring cache failed: ${error}`);
    }
}

run();

export default run;
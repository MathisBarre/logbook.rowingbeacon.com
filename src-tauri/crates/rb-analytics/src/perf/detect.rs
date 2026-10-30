//! What the machine has (ADR 0008, "Performance profiles"): physical
//! memory, logical CPUs, architecture, and whether it is a Raspberry Pi.
//! No dependency: `/proc/meminfo`, the cgroup memory limit (a container,
//! or a kiosk service under systemd `MemoryMax=`) and the device tree on
//! Linux,
//! `sysctlbyname("hw.memsize")` on macOS, `GlobalMemoryStatusEx` on
//! Windows. Whatever cannot be read is `None`, and an unknown machine is
//! recommended the Économe profile.

use super::{MachineInfo, Profile};

const GIB: u64 = 1024 * 1024 * 1024;

/// Detected memory of an "8 GB" machine: firmware, GPU and kernel keep
/// some of it (7.6 to 7.8 GiB in /proc/meminfo), so 90 % counts.
pub const STANDARD_MIN_MEMORY: u64 = 8 * GIB / 10 * 9;
/// Same for a "16 GB" machine.
pub const POWERFUL_MIN_MEMORY: u64 = 16 * GIB / 10 * 9;
pub const STANDARD_MIN_CPUS: u32 = 4;
pub const POWERFUL_MIN_CPUS: u32 = 8;

/// The profile a machine is advised to use.
///
/// - A Raspberry Pi always gets Économe: the limits of the app were sized
///   for it, and its SD card and cooling stay the bottleneck.
/// - Unknown memory gets Économe.
/// - Puissant from 16 GB and 8 logical CPUs, Standard from 8 GB and 4.
/// - Linux on ARM (single-board computers) goes one level down; Apple
///   Silicon and Windows on ARM keep their level.
pub fn recommend(
    total_memory: Option<u64>,
    logical_cpus: u32,
    arch: &str,
    os: &str,
    raspberry_pi: bool,
) -> Profile {
    let Some(memory) = total_memory else {
        return Profile::Economy;
    };
    if raspberry_pi {
        return Profile::Economy;
    }
    let level = if memory >= POWERFUL_MIN_MEMORY && logical_cpus >= POWERFUL_MIN_CPUS {
        Profile::Powerful
    } else if memory >= STANDARD_MIN_MEMORY && logical_cpus >= STANDARD_MIN_CPUS {
        Profile::Standard
    } else {
        Profile::Economy
    };
    let arm = arch.starts_with("arm") || arch == "aarch64";
    if os == "linux" && arm {
        level.lower()
    } else {
        level
    }
}

/// `MemTotal` of `/proc/meminfo` (kB), in bytes.
pub fn parse_meminfo(text: &str) -> Option<u64> {
    let line = text.lines().find(|line| line.starts_with("MemTotal:"))?;
    let mut parts = line["MemTotal:".len()..].split_whitespace();
    let value: u64 = parts.next()?.parse().ok()?;
    let unit = parts.next().unwrap_or("kB");
    let bytes = match unit {
        "kB" | "KB" | "kb" => value.checked_mul(1024)?,
        "B" => value,
        _ => return None,
    };
    (bytes > 0).then_some(bytes)
}

/// A cgroup memory limit file: cgroup v2 `memory.max` ("max": none) or
/// v1 `memory.limit_in_bytes` (a huge value, near 2^63: none).
pub fn parse_cgroup_limit(text: &str) -> Option<u64> {
    let value: u64 = text.trim().parse().ok()?;
    (value > 0 && value < 1 << 60).then_some(value)
}

/// The memory limit files of this process's cgroups, from the text of
/// `/proc/self/cgroup`: for its cgroup and every parent up to the root
/// (a limit set on a parent slice applies too), the v2 `memory.max` and
/// the v1 `memory.limit_in_bytes`. In a container the path may name the
/// host's hierarchy: its root, the container's own, is in the list.
pub fn cgroup_limit_files(proc_self_cgroup: &str) -> Vec<std::path::PathBuf> {
    let root = std::path::Path::new("/sys/fs/cgroup");
    let mut files = Vec::new();
    for line in proc_self_cgroup.lines() {
        let mut parts = line.splitn(3, ':');
        let (Some(id), Some(controllers), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (base, file) = if id == "0" && controllers.is_empty() {
            (root.to_path_buf(), "memory.max")
        } else if controllers.split(',').any(|c| c == "memory") {
            (root.join("memory"), "memory.limit_in_bytes")
        } else {
            continue;
        };
        for dir in std::path::Path::new(path).ancestors() {
            let relative = dir.strip_prefix("/").unwrap_or(dir);
            if relative
                .components()
                .any(|c| !matches!(c, std::path::Component::Normal(_)))
            {
                continue;
            }
            files.push(base.join(relative).join(file));
        }
    }
    files
}

/// The lower of the physical memory and the cgroup limit, if any.
pub fn effective_memory(physical: Option<u64>, cgroup: Option<u64>) -> Option<u64> {
    match (physical, cgroup) {
        (Some(physical), Some(limit)) => Some(physical.min(limit)),
        (physical, _) => physical,
    }
}

/// Whether a device-tree model or `/proc/cpuinfo` names a Raspberry Pi.
pub fn is_raspberry_pi(text: &str) -> bool {
    text.contains("Raspberry Pi")
}

/// The machine this process runs on.
pub fn detect() -> MachineInfo {
    let total_memory_bytes = imp::total_memory();
    let logical_cpus = std::thread::available_parallelism()
        .map(|n| u32::try_from(n.get()).unwrap_or(u32::MAX))
        .unwrap_or(1);
    let arch = std::env::consts::ARCH.to_string();
    let os = std::env::consts::OS.to_string();
    let raspberry_pi = imp::raspberry_pi();
    let recommended = recommend(total_memory_bytes, logical_cpus, &arch, &os, raspberry_pi);
    MachineInfo {
        total_memory_bytes,
        logical_cpus,
        arch,
        os,
        raspberry_pi,
        recommended,
    }
}

#[cfg(target_os = "linux")]
mod imp {
    /// `MemTotal`, or the cgroup limit when it is lower (review D, L3): the
    /// app gets killed at the cgroup limit, not at the machine's memory.
    pub fn total_memory() -> Option<u64> {
        let physical = std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|text| super::parse_meminfo(&text));
        let cgroup = std::fs::read_to_string("/proc/self/cgroup")
            .ok()
            .and_then(|text| {
                super::cgroup_limit_files(&text)
                    .iter()
                    .filter_map(|file| std::fs::read_to_string(file).ok())
                    .filter_map(|text| super::parse_cgroup_limit(&text))
                    .min()
            });
        super::effective_memory(physical, cgroup)
    }

    pub fn raspberry_pi() -> bool {
        [
            "/proc/device-tree/model",
            "/sys/firmware/devicetree/base/model",
            "/proc/cpuinfo",
        ]
        .iter()
        .filter_map(|path| std::fs::read(path).ok())
        .any(|bytes| super::is_raspberry_pi(&String::from_utf8_lossy(&bytes)))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_char, c_int, c_void};

    extern "C" {
        // libSystem, always linked.
        fn sysctlbyname(
            name: *const c_char,
            oldp: *mut c_void,
            oldlenp: *mut usize,
            newp: *mut c_void,
            newlen: usize,
        ) -> c_int;
    }

    pub fn total_memory() -> Option<u64> {
        let mut value: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        // SAFETY: "hw.memsize" is a 64-bit integer; `value` and `len`
        // describe a buffer of that size, and nothing is written back.
        let rc = unsafe {
            sysctlbyname(
                c"hw.memsize".as_ptr(),
                (&mut value as *mut u64).cast::<c_void>(),
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        (rc == 0 && len == std::mem::size_of::<u64>() && value > 0).then_some(value)
    }

    pub fn raspberry_pi() -> bool {
        false
    }
}

#[cfg(windows)]
mod imp {
    /// `MEMORYSTATUSEX` (sysinfoapi.h).
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }

    pub fn total_memory() -> Option<u64> {
        let mut status = MemoryStatusEx {
            length: std::mem::size_of::<MemoryStatusEx>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page_file: 0,
            avail_page_file: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended_virtual: 0,
        };
        // SAFETY: `status` is a MEMORYSTATUSEX with `dwLength` set, as
        // the function requires.
        let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
        (ok != 0 && status.total_phys > 0).then_some(status.total_phys)
    }

    pub fn raspberry_pi() -> bool {
        false
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
mod imp {
    pub fn total_memory() -> Option<u64> {
        None
    }

    pub fn raspberry_pi() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_meminfo() {
        let pi4 = "MemTotal:        3884076 kB\nMemFree:          212340 kB\n";
        assert_eq!(parse_meminfo(pi4), Some(3_884_076 * 1024));
        let laptop = "MemFree: 1 kB\nMemTotal:       32554812 kB\n";
        assert_eq!(parse_meminfo(laptop), Some(32_554_812 * 1024));
        for bad in [
            "",
            "MemFree: 12 kB",
            "MemTotal: x kB",
            "MemTotal: 0 kB",
            "MemTotal: 5 MB",
        ] {
            assert_eq!(parse_meminfo(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn reads_cgroup_memory_limits() {
        assert_eq!(parse_cgroup_limit("max\n"), None);
        assert_eq!(parse_cgroup_limit("2147483648\n"), Some(2 * GIB));
        assert_eq!(parse_cgroup_limit("9223372036854771712\n"), None);
        assert_eq!(parse_cgroup_limit("0"), None);
        assert_eq!(parse_cgroup_limit(""), None);

        // cgroup v2, a kiosk service under systemd.
        let v2 = cgroup_limit_files("0::/system.slice/kiosk.service\n");
        let names: Vec<String> = v2.iter().map(|p| p.display().to_string()).collect();
        assert_eq!(
            names,
            [
                "/sys/fs/cgroup/system.slice/kiosk.service/memory.max",
                "/sys/fs/cgroup/system.slice/memory.max",
                "/sys/fs/cgroup/memory.max",
            ]
        );
        // cgroup v1: only the memory hierarchy.
        let v1 = cgroup_limit_files("5:cpu,cpuacct:/a\n4:memory:/docker/abc\n0::/\n");
        let names: Vec<String> = v1.iter().map(|p| p.display().to_string()).collect();
        assert_eq!(
            names,
            [
                "/sys/fs/cgroup/memory/docker/abc/memory.limit_in_bytes",
                "/sys/fs/cgroup/memory/docker/memory.limit_in_bytes",
                "/sys/fs/cgroup/memory/memory.limit_in_bytes",
                "/sys/fs/cgroup/memory.max",
            ]
        );
        // Nothing outside /sys/fs/cgroup.
        assert!(cgroup_limit_files("0::/../../etc\n")
            .iter()
            .all(|p| p.starts_with("/sys/fs/cgroup") && !p.display().to_string().contains("..")));
        assert!(cgroup_limit_files("garbage").is_empty());

        // A 32 GB host, a 2 GB container: 2 GB, so Économe.
        let memory = effective_memory(Some(32 * GIB), Some(2 * GIB));
        assert_eq!(memory, Some(2 * GIB));
        assert_eq!(
            recommend(memory, 8, "x86_64", "linux", false),
            Profile::Economy
        );
        assert_eq!(effective_memory(Some(8 * GIB), None), Some(8 * GIB));
        assert_eq!(effective_memory(None, Some(GIB)), None);
    }

    #[test]
    fn recognises_a_raspberry_pi() {
        assert!(is_raspberry_pi("Raspberry Pi 4 Model B Rev 1.4\0"));
        assert!(is_raspberry_pi(
            "processor\t: 0\nModel\t\t: Raspberry Pi 5 Model B Rev 1.0\n"
        ));
        assert!(!is_raspberry_pi("Pine64 RockPro64 v2.1"));
        assert!(!is_raspberry_pi("model name\t: Intel(R) Core(TM) i7"));
    }

    #[test]
    fn recommends_a_profile() {
        let gb = |n: u64| Some(n * GIB);
        // A 4 GB and an 8 GB Raspberry Pi stay on Économe.
        assert_eq!(
            recommend(gb(4), 4, "aarch64", "linux", true),
            Profile::Economy
        );
        assert_eq!(
            recommend(gb(8), 4, "aarch64", "linux", true),
            Profile::Economy
        );
        // Unknown memory.
        assert_eq!(
            recommend(None, 16, "x86_64", "windows", false),
            Profile::Economy
        );
        // "8 GB" laptop reporting 7.6 GiB, 8 threads.
        let laptop = Some(7_600 * 1024 * 1024 * 1024 / 1000);
        assert_eq!(
            recommend(laptop, 8, "x86_64", "windows", false),
            Profile::Standard
        );
        // Old 4 GB PC.
        assert_eq!(
            recommend(gb(4), 4, "x86_64", "windows", false),
            Profile::Economy
        );
        // 8 GB but 2 cores.
        assert_eq!(
            recommend(gb(8), 2, "x86_64", "linux", false),
            Profile::Economy
        );
        // 16 GB and 8 cores; "16 GB" reporting 15.5 GiB.
        assert_eq!(
            recommend(gb(16), 8, "x86_64", "linux", false),
            Profile::Powerful
        );
        let sixteen = Some(15_500 * 1024 * 1024 * 1024 / 1000);
        assert_eq!(
            recommend(sixteen, 12, "x86_64", "linux", false),
            Profile::Powerful
        );
        assert_eq!(
            recommend(gb(32), 4, "x86_64", "linux", false),
            Profile::Standard
        );
        // Apple Silicon and Windows on ARM keep their level.
        assert_eq!(
            recommend(gb(16), 8, "aarch64", "macos", false),
            Profile::Powerful
        );
        assert_eq!(
            recommend(gb(16), 8, "aarch64", "windows", false),
            Profile::Powerful
        );
        // Another ARM board on Linux goes one level down.
        assert_eq!(
            recommend(gb(16), 8, "aarch64", "linux", false),
            Profile::Standard
        );
        assert_eq!(recommend(gb(8), 8, "arm", "linux", false), Profile::Economy);
    }

    #[test]
    fn detects_this_machine() {
        let machine = detect();
        assert!(machine.logical_cpus >= 1);
        assert_eq!(machine.arch, std::env::consts::ARCH);
        assert_eq!(machine.os, std::env::consts::OS);
        #[cfg(any(target_os = "linux", target_os = "macos", windows))]
        assert!(machine
            .total_memory_bytes
            .is_some_and(|m| m > 64 * 1024 * 1024));
        assert_eq!(
            machine.recommended,
            recommend(
                machine.total_memory_bytes,
                machine.logical_cpus,
                &machine.arch,
                &machine.os,
                machine.raspberry_pi
            )
        );
    }
}

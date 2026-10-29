//! Quitting goes through the menu bar. ⌘Q, the Dock's "Quit" and the app menu only send CURI back
//! to the menu bar; "Quit CURI" in the menu bar icon is the one way out. macOS asks the app delegate
//! `applicationShouldTerminate:` before quitting, and tao doesn't answer it, so we add the answer.
//! Logging out, restarting and shutting down always go through: macOS marks those quits with a reason.

use objc2::{
    ffi, msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};
use tauri::AppHandle;

static ALLOWED: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

const TERMINATE_CANCEL: usize = 0;
const TERMINATE_NOW: usize = 1;
/// `keyQuitReason`: present on the quit event when the system logs out, restarts or shuts down.
const KEY_QUIT_REASON: u32 = u32::from_be_bytes(*b"why?");

/// Lets the next quit through. Only "Quit CURI" in the menu bar calls this.
pub fn allow() {
    ALLOWED.store(true, Ordering::SeqCst);
}

fn system_is_quitting() -> bool {
    let Some(cls) = AnyClass::get(c"NSAppleEventManager") else {
        return false;
    };
    unsafe {
        let mgr: *mut AnyObject = msg_send![cls, sharedAppleEventManager];
        if mgr.is_null() {
            return false;
        }
        let ev: *mut AnyObject = msg_send![mgr, currentAppleEvent];
        if ev.is_null() {
            return false;
        }
        let reason: *mut AnyObject = msg_send![ev, attributeDescriptorForKeyword: KEY_QUIT_REASON];
        !reason.is_null()
    }
}

extern "C-unwind" fn should_terminate(
    _this: *mut AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> usize {
    if ALLOWED.load(Ordering::SeqCst) || system_is_quitting() {
        return TERMINATE_NOW;
    }
    if let Some(app) = APP.get() {
        crate::hide_window(app);
    }
    TERMINATE_CANCEL
}

/// Installs the guard on the app delegate. Call once, after the event loop exists (in `setup`).
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let Some(ns_app) = AnyClass::get(c"NSApplication") else {
        return;
    };
    unsafe {
        let shared: *mut AnyObject = msg_send![ns_app, sharedApplication];
        let delegate: *mut AnyObject = msg_send![shared, delegate];
        if delegate.is_null() {
            return;
        }
        let cls: *const AnyClass = msg_send![delegate, class];
        let imp: Imp = std::mem::transmute(
            should_terminate as extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
        );
        ffi::class_replaceMethod(
            cls as *mut AnyClass,
            sel!(applicationShouldTerminate:),
            imp,
            c"Q@:@".as_ptr(),
        );
    }
}

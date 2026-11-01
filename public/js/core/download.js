// Hands the viewer a file to save, the way any web page does: a temporary link with a download name.
export function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // the browser has started the download by now; the link can go after a while
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

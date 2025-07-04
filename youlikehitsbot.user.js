// ==UserScript==
// @name         YouLikeHits Bot
// @namespace    https://github.com/gekkedev/youlikehitsbot
// @version      0.5.1
// @description  Interacts with YLH automatically whereever possible.
// @author       gekkedev & Xnuvers007
// @updateURL    https://raw.githubusercontent.com/gekkedev/youlikehitsbot/master/youlikehitsbot.user.js
// @downloadURL  https://raw.githubusercontent.com/gekkedev/youlikehitsbot/master/youlikehitsbot.user.js
// @match        *://*.youlikehits.com/login.php
// @match        *://*.youlikehits.com/soundcloudplays.php*
// @match        *://*.youlikehits.com/websites.php*
// @match        *://*.youlikehits.com/viewwebsite.php*
// @match        *://*.youlikehits.com/youtubenew2.php*
// @match        *://*.youlikehits.com/bonuspoints.php*
// @grant        GM.getValue
// @grant        GM.setValue
// @require      https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js
// @require      https://greasemonkey.github.io/gm4-polyfill/gm4-polyfill.js
// @require      https://cdn.jsdelivr.net/gh/naptha/tesseract.js/dist/tesseract.min.js
// ==/UserScript==

(() => {
    const J = jQuery.noConflict(true);
    /** how many miliseconds to wait between launching another loop */
    const globalInterval = 2000;

    solveCaptcha = (imageEl, outputEl, captchaIdentifier, callback = () => {}) => {
        if (window[captchaIdentifier] == undefined) {
            window[captchaIdentifier] = true; //solving takes some time, so we'll lock a duplicate solver instance out
            let note = attachNotification(imageEl, "Please wait while your captcha is being solved. Don't worry if the code does not seem to match; that's because a new captcha image has been generated!");
            Tesseract.recognize(J(imageEl).attr("src")).then(equation => {
                var formula = equation.text;
                if (formula.length = 3) {//the exact length of the fomula
                    if (formula.substr(1, 1) == 7) { //2-1 gets recognized as 271
                        formula = formula.substr(0, 1) + "-" + formula.substr(2);
                    }
                    formula = formula.replace(/x/g, "*"); //x is just the human version of *
                    formula = formula.replace(/[} ]/g, ""); //a random char being the result of misinterpretation; occasionally happening on the login form
                    //console.log(formula); //re-enable this to debug how the captchasolving is doing so far
                    outputEl.val(eval(formula));
                    window[captchaIdentifier] = false; //not really necessary IF directly triggering a classic non-ajax post request
                    removeNotification(note);
                    callback()
                }
            });
        }
    }

    const attachNotification = (identifier, notification) => {
        //IDEA: turn it into a nice(r) GUI with an ID to check more efficiently for duplicates
        const el = "<p style='color: red;'>Bot says: <i>" + notification + "</i></p>";
        const prevEl = J(identifier).prev()[0];
        if (prevEl == undefined || !prevEl.innerText.includes(notification))
           return J(el).insertBefore(identifier);
    }

    const removeNotification = (el) => {
        if (el != undefined)
            el.remove()
    }

    /** input seconds, receive milliseconds */
    const randomSeconds = (from, to) => {
        return Math.floor(Math.random() * (to - from + 1) + from) * 1000
    }

    const alertOnce = (message, identifier) => {
        localIdentifier = (identifier != undefined) ? identifier : message;
        if (shownWarnings.indexOf(localIdentifier) == -1) {
            shownWarnings.push(localIdentifier);
            alert(message)
        }
    }

    //runtime vars
    let previousVideo = "";
    /** indicates if a warning/message has already been shown. Happens once per window. Use alertOnce() */
    let shownWarnings = [];

    //loop over the website to find out which subpage we are on and take the appropriate actions IDEA: refactor the loop into a singleton
    const mainLoop = setInterval(() => {
        if (J("*:contains('503 Service Unavailable')").length) {
            console.log("Server Error! reloading...");
            location.reload();
        } else if (J("*:contains('not logged in!')").length) {
            window.location.href = "login.php"
        } else if (J("*:contains('Failed. You did not successfully solve the problem.')").length) {
            J("a:contains('Try Again')")[0].click()
        } else {
                switch (document.location.pathname) {
                    case "/login.php":
                        if (!J("#password").val().length) attachNotification("#username", "Consider storing your login data in your browser.")
                        const captcha = J("img[alt='Enter The Numbers']");
                        if (captcha.length)
                            solveCaptcha(captcha[0], J("input[name='postcaptcha']"), "ylh_login_captchasolving");
                        break;
                    case "/bonuspoints.php":
                        if (J("body:contains('You have made ')").length && J("body:contains(' Hits out of ')").length) {
                            const reloadDelay = randomSeconds(60, 60 * 5);
                            attachNotification(".maintable", "Not enough points. Reloading the website in " + Math.round(reloadDelay / 1000 / 60) + " minutes to check again...");
                            setTimeout(() => location.reload(), reloadDelay);
                            clearInterval(mainLoop); //no further checks since we gotta reload anyway
                        } else if (J(".buybutton").length) J(".buybutton")[0].click()
                        break;
                    case "/soundcloudplays.php":
                         //no timer visible / no song currently playing?
                        if (!J(".maintable span[id*='count']").attr("style").includes("display:none;")) return attachNotification(".maintable", "Music already playing..."); //TODO: detect timers that do not update
                        if (J(".followbutton").length) {
                            J(".followbutton").first().click();
                        } else alert("no followbutton, fix this pls");
                    case "/youtubenew2.php":
                        if (J("#listall:contains('There are no videos available to view at this time')").length) {
                            console.log("No videos available. Reloading page...");
                            setTimeout(() => location.reload(), 3000);
                            return;
                        }
                        if (J('body:contains("failed")').length) location.reload(); //captcha failed?
                        if (J(".followbutton").length) { // if false, there is likely a captcha waiting to be solved
                            let vidID = () => {
                                return J(".followbutton").first().parent().children("span[id*='count']").attr("id");
                            };

                            // get value points (from parent().html())
                            let pointsLine = J(".followbutton").parent().html();
                            let pointsMatch = pointsLine.match(/Points<\/b>:\s*(\d+)/);
                            let points = pointsMatch ? parseInt(pointsMatch[1]) : 0;

                            let patienceKiller = (prev) => {
                                setTimeout(() => {
                                    if (vidID() == prev) {
                                        J(".followbutton").parent().children("a:contains('Skip')").click();
                                        if (typeof(newWin) !== "undefined") newWin.close();
                                    }
                                }, 1000 * 230); // max time: 120s + 15s grace time -> change become 230 because when get timer 203 it will skip :) logic error
                            };

                            if (vidID() != previousVideo) { // has a new video been provided?
                                previousVideo = vidID();
                                if (typeof(window.newWin) !== 'undefined') {
                                    if (newWin.closed) {
                                        console.log("Checking Points...");
                                        if (points > 5) { // in this, you can edit point what you want to get (minimal, default > 5 point view, if < 5 point skip
                                            console.log("Points = " + points + " > 5. Viewing video.");
                                            J(".followbutton")[0].click();
                                        } else {
                                            console.log("Points = " + points + " <= 5. Skipping video.");
                                            J(".followbutton").parent().children("a:contains('Skip')").click();
                                        }
                                        patienceKiller(previousVideo);
                                    }
                                } else {
                                    console.log("Checking Points...");
                                    if (points > 5) {
                                        console.log("Points = " + points + " > 5. Viewing video.");
                                        J(".followbutton")[0].click();
                                    } else {
                                        console.log("Points = " + points + " <= 5. Skipping video.");
                                        J(".followbutton").parent().children("a:contains('Skip')").click();
                                    }
                                    patienceKiller(previousVideo);
                                }
                            }
                            // else do nothing and wait (until the video gets replaced or patience thread tears)
                        } else {
                            captcha = J("img[src*='captchayt']");
                            if (captcha.length) {
                                // captcha? no problemo, amigo.
                                solveCaptcha(
                                    captcha[0],
                                    J("input[name='answer']"),
                                    "ylh_yt_traffic_captchasolving",
                                    () => J("input[value='Submit']").first().click()
                                );
                            }
                        }
                        break;
                }
            GM.getValue("ylh_traffic_tab_open", false).then(state => {
                switch (document.location.pathname) {
                    case "/websites.php":
                        if (J("*:contains('There are no Websites currently visitable for Points')").length) {
                            alertOnce("All websites were visited. Revisit/reload the page to start surfing again.")
                        } else {
                            if (!state && window.eval("typeof(window.childWindow) !== 'undefined'")) {
                                if (!childWindow.closed)
                                    childWindow.close();
                            } else if (state && window.eval("typeof(window.childWindow) == 'undefined'")) {
                                console.log("no child window is actually open. let's create a new tab as if we came here for the very first time!");
                                state = false;
                            }
                            var buttons = J(".followbutton:visible");
                            if (buttons.length) {
                                if (!state) {
                                    console.log("setting the tabstate to true...");
                                    GM.setValue('ylh_traffic_tab_open', true).then(() => {
                                        console.log("Visiting a new page...");
                                        buttons[0].onclick();
                                    });
                                } else {
                                }
                            } else {
                                console.log("We ran out of buttons! requesting more...");
                                //GM.getValue("ylh_traffic_reloadlimit", false).then(rlimit => {
                                if (window.eval("typeof(window.childWindow) !== 'undefined'") && childWindow.closed) //without this we would not wait for the last link of the page to be visited successfully
                                    location.reload();
                                //J("a[title='Refresh']")[0].click();
                            }
                        }
                        break;
                    case "/viewwebsite.php":
                        if (!J("*:contains('been logged out of YouLikeHits')").length) {
                            if (
                              J(".alert:visible:contains('You got'):contains('Points')").length
                              || J('body:contains("We couldn\'t locate the website you\'re attempting to visit.")').length
                              || J('body:contains("You have successfully reported")').length
                            ) {
                                console.log("setting the tabstate to false...");
                                GM.setValue('ylh_traffic_tab_open', false).then(() => { //free the way for a new tab
                                    /*window.close(); //might not always work in FF
                                    setTimeout (window.close, 1000);*/
                                });
                            } else if (J("*:contains('viewing websites too quickly! Please wait')").length) location.reload();
                        } else alert("Please reload the website list, and make sure you are still logged in.");
                        break;
                }
            });
        }
    }, globalInterval);
})();

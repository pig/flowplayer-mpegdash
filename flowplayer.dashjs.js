/*jslint browser: true, for: true */
/*global dashjs, flowplayer, MediaPlayer, window */

/*!

   MPEG-DASH engine plugin for Flowplayer HTML5

   Copyright (c) 2015-2016, Flowplayer Oy

   Released under the MIT License:
   http://www.opensource.org/licenses/mit-license.php

   Includes hls.js
   Copyright (c) 2015 Dailymotion (http://www.dailymotion.com)
   https://github.com/dailymotion/hls.js/blob/master/LICENSE

   Includes es5.js
   https://github.com/inexorabletash/polyfill/blob/master/es5.js
   for compatibility with legacy browsers

   Requires Flowplayer HTML5 version 6.x
   revision: $GIT_ID$

*/

(function(flowplayer, dashjs) {
    "use strict";
    var engineName = "dash",
        mse = window.MediaSource,
        common = flowplayer.common,
        extend = flowplayer.extend,
        version = flowplayer.version,
        dashconf,

        dashCanPlay = function(sourceType, dashType, dashCodecs) {
            return sourceType.toLowerCase() === "application/dash+xml" &&
                mse.isTypeSupported(dashType + ';codecs="' + dashCodecs + '"') &&
                // Android MSE advertises he-aac, but fails
                (dashCodecs.indexOf("mp4a.40.5") < 0 || navigator.userAgent.indexOf("Android") < 0);
        },

        dashQualitiesSupport = function(conf) {
            var dashQualities = conf.clip.dashQualities || conf.dashQualities;

            return (dashQualities === true || (dashQualities && dashQualities.length));
        },

        engineImpl = function dashjsEngine(player, root) {
            var bean = flowplayer.bean,
                mediaPlayer,
                videoTag,
                bc,
                has_bg,

                qActive = "active",

                dataQuality = function(quality) {
                    if (!quality) {
                        quality = player.quality;
                    }
                    console.log("data quality : " + quality.toLowerCase().replace(/\ /g, ""));
                    return quality.toLowerCase().replace(/\ /g, "");
                },

                removeAllQualityClasses = function() {
                    var qualities = player.qualities;

                    if (!qualities || !qualities.length) {
                        return;
                    }
                    common.removeClass(root, "quality-abr");
                    qualities.forEach(function(quality) {
                        common.removeClass(root, "quality-" + dataQuality(quality));
                    });
                },

                qClean = function() {
                    delete player.dashQualities;
                    removeAllQualityClasses();
                    common.find(".fp-quality-selector", root).forEach(common.removeNode);
                },

                qIndex = function() {
                    return player.dashQualities[player.qualities.indexOf(player.quality) + 1];
                },

                initQualitySelection = function(dashQualitiesConf, conf, dashApi) {
                    var bitrates = dashApi.getBitrateInfoListFor("video");
                    var dashQualities = [];
                    var qIndices = [];
                    var bitrateIndx = 0;
                    var selector;

                    qClean();

                    if (bitrates.length < 2) return;

                    bitrates.forEach(function(bitrate) {
                        if (dashQualitiesConf === true || qIndices.indexOf(bitrateIndx) > -1) {
                            dashQualities.push(bitrateIndx);
                        }
                        bitrateIndx += 1;
                    });

                    if (dashQualities.length < 2) {
                        return;
                    }

                    player.qualities = [];
                    dashQualities.forEach(function(dashQuality, idx) {
                        var bitrateObj = bitrates[idx];
                        var level = bitrateObj.qualityIndex,
                            width = bitrateObj.width,
                            height = bitrateObj.height,
                            bitrate = bitrateObj.bitrate,
                            label = (width && height) ?
                            Math.min(width, height) + "p-" + (bitrate / 1000000).toFixed(1) + "Mbps" :
                            "Quality Level " + (level + 1);
                        player.qualities.push(label);
                    });
                    console.log("dashQualities : " + dashQualities);

                    console.log("SET selector root");
                    selector = common.createElement("ul", {
                        "class": "fp-quality-selector"
                    });
                    common.find(".fp-ui", root)[0].appendChild(selector);

                    console.log("SET qualities into player config");
                    dashQualities.unshift(-1);
                    player.dashQualities = dashQualities;
                    if (!player.quality || player.qualities.indexOf(player.quality) < 0) {
                        player.quality = "abr";
                        console.log("set to quality auto choose.");
                    }

                    console.log("SET Video qualities list");
                    selector.appendChild(common.createElement("li", {
                        "data-quality": "abr"
                    }, "Auto"));
                    player.qualities.forEach(function(q) {
                        selector.appendChild(common.createElement("li", {
                            "data-quality": dataQuality(q)
                        }, q));
                    });
                    common.addClass(root, "quality-" + dataQuality());

                    console.log("Binding the events on each quality option.");
                    // Binding the click event
                    bean.on(root, "click." + engineName, ".fp-quality-selector li", function(e) {
                        var choice = e.currentTarget,
                            selectors,
                            active,
                            isAutoQualitySwitch,
                            paused = videoTag.paused,
                            i;

                        if (common.hasClass(choice, qActive)) {
                            return;
                        }

                        if (!paused) {
                            bean.one(videoTag, "pause." + engineName, function() {
                                common.removeClass(root, "is-paused");
                            });
                        }

                        selectors = common.find(".fp-quality-selector li", root);
                        for (i = 0; i < selectors.length; i += 1) {
                            active = selectors[i] === choice;
                            isAutoQualitySwitch = i <= 0;
                            if (active) {
                                player.quality = isAutoQualitySwitch ?
                                    "abr" :
                                    player.qualities[i - 1];
                                if (isAutoQualitySwitch) {
                                    console.log("changing the quality to [AUTO].");
                                    dashApi.setAutoSwitchQualityFor("video", true);
                                } else {
                                    console.log("changing the quality to [Level " + i - 1 + "]");
                                    dashApi.setAutoSwitchQualityFor("video", false);
                                    dashApi.setQualityFor("video", i - 1);
                                }
                                common.addClass(choice, qActive);
                                if (paused) {
                                    videoTag.play();
                                }
                            }
                            common.toggleClass(selectors[i], qActive, active);
                        }
                        removeAllQualityClasses();
                        common.addClass(root, "quality-" + dataQuality());
                    }); // END of Binding events
                },

                engine = {
                    engineName: engineName,

                    pick: function(sources) {
                        var i,
                            source,
                            dashType,
                            dashCodecs;

                        for (i = 0; i < sources.length; i += 1) {
                            source = sources[i];
                            dashType = source.dashType || dashconf.type;
                            dashCodecs = source.dashCodecs || dashconf.codecs;
                            if (dashCanPlay(source.type, dashType, dashCodecs)) {
                                if (typeof source.src === 'string') {
                                    source.src = common.createAbsoluteUrl(source.src);
                                }
                                return source;
                            }
                        }
                    },

                    load: function(video) {
                        var conf = player.conf,
                            dashUpdatedConf = extend(dashconf, conf.dash, conf.clip.dash),
                            EVENTS = {
                                ended: "finish",
                                loadeddata: "ready",
                                pause: "pause",
                                play: "resume",
                                progress: "buffer",
                                ratechange: "speed",
                                seeked: "seek",
                                timeupdate: "progress",
                                volumechange: "volume"
                            },
                            DASHEVENTS = dashjs.MediaPlayer.events,
                            autoplay = !!video.autoplay || !!conf.autoplay,
                            posterClass = "is-poster",
                            livestartpos = 0,
                            dashUpdatedConf = extend(dashconf, conf.dash, conf.clip.dash),
                            dashQualitiesConf = video.dashQualities || conf.dashQualities,
                            dashClientConf = extend({}, dashUpdatedConf);

                        if (!mediaPlayer) {
                            common.removeNode(common.findDirect("video", root)[0] ||
                                common.find(".fp-player > video", root)[0]);
                            // dash.js enforces preload="auto" and
                            // autoplay depending on initialization
                            // so setting the attributes here will have no effect
                            videoTag = common.createElement("video", {
                                "class": "fp-engine " + engineName + "-engine",
                                "x-webkit-airplay": "allow"
                            });

                            Object.keys(EVENTS).forEach(function(key) {
                                var flow = EVENTS[key],
                                    type = key + "." + engineName,
                                    arg;

                                bean.on(videoTag, type, function(e) {
                                    if (conf.debug && flow.indexOf("progress") < 0) {
                                        console.log(type, "->", flow, e.originalEvent);
                                    }
                                    if (!player.ready && flow.indexOf("ready") < 0) {
                                        return;
                                    }

                                    var ct = 0,
                                        buffer = 0,
                                        buffend = 0,
                                        buffered,
                                        i;

                                    switch (flow) {
                                        case "ready":
                                            arg = extend(player.video, {
                                                duration: videoTag.duration,
                                                seekable: videoTag.seekable.end(null),
                                                width: videoTag.videoWidth,
                                                height: videoTag.videoHeight,
                                                url: player.video.src
                                            });
                                            break;
                                        case "resume":
                                            if (player.poster) {
                                                player.poster = false;
                                                common.removeClass(root, posterClass);
                                            }
                                            break;
                                        case "seek":
                                        case "progress":
                                            ct = videoTag.currentTime;
                                            if (player.video.live && !livestartpos && ct > 0) {
                                                livestartpos = ct;
                                            }
                                            arg = !player.video.live ?
                                                ct :
                                                livestartpos ?
                                                ct - livestartpos :
                                                0;
                                            break;
                                        case "speed":
                                            arg = videoTag.playbackRate;
                                            break;
                                        case "volume":
                                            arg = videoTag.volume;
                                            break;
                                        case "buffer":
                                            try {
                                                ct = videoTag.currentTime;
                                                // cycle through time ranges to obtain buffer
                                                // nearest current time
                                                if (ct) {
                                                    buffered = videoTag.buffered;
                                                    for (i = buffered.length - 1; i > -1; i -= 1) {
                                                        buffend = buffered.end(i);

                                                        if (buffend >= ct) {
                                                            buffer = buffend;
                                                        }
                                                    }
                                                }
                                            } catch (ignore) {}
                                            video.buffer = buffer;
                                            arg = e;
                                            break;
                                    }

                                    player.trigger(flow, [player, arg]);
                                });
                            });

                            if (conf.poster) {
                                var posterHack = function() {
                                    setTimeout(function() {
                                        if (!player.poster) {
                                            common.addClass(root, posterClass);
                                            player.poster = true;
                                        }
                                    }, 0);
                                };

                                player.one("ready." + engineName, posterHack).on("stop." + engineName, posterHack);
                            }
                            player.on("error." + engineName, function() {
                                if (mediaPlayer) {
                                    mediaPlayer.reset();
                                    mediaPlayer = 0;
                                }
                            });

                            mediaPlayer = dashjs.MediaPlayer().create();
                            player.engine[engineName] = mediaPlayer;

                            // new ABR algo
                            mediaPlayer.enableBufferOccupancyABR(!!dashUpdatedConf.bufferOccupancyABR);
                            // caching can cause failures in playlists
                            // for the moment disable entirely
                            mediaPlayer.enableLastBitrateCaching(false);
                            // for seeking in paused state
                            mediaPlayer.setScheduleWhilePaused(true);
                            mediaPlayer.getDebug().setLogToBrowserConsole(!!dashUpdatedConf.debug);

                            Object.keys(DASHEVENTS).forEach(function(key) {
                                var etype = DASHEVENTS[key],
                                    fpEventType = engineName + etype.charAt(0).toUpperCase() + etype.slice(1),
                                    listeners = dashUpdatedConf.listeners,
                                    expose = listeners && listeners.indexOf(etype) > -1;

                                mediaPlayer.on(etype, function(e) {
                                    var data = extend({}, e),
                                        src = player.video.src,
                                        fperr,
                                        errobj;

                                    delete data.type;
                                    switch (key) {
                                        case "STREAM_INITIALIZED":
                                            console.log("[DASH EVENT ON - STREAM_INITIALIZED]");
                                            if (dashQualitiesSupport(conf)) {
                                                initQualitySelection(dashQualitiesConf, dashUpdatedConf, mediaPlayer);
                                            } else {
                                                delete player.quality;
                                            }
                                            break;
                                        case "CAN_PLAY":
                                            console.log("[DASH EVENT ON - CAN_PLAY]");
                                            // set active according to the player.quality.
                                            var selectorIndex = 0;
                                            var quality = player.quality;
                                            if (quality) {
                                                selectorIndex = quality === "abr" ?
                                                    0 :
                                                    player.qualities.indexOf(quality) + 1;
                                                common.addClass(common.find(".fp-quality-selector li", root)[selectorIndex], qActive);
                                            } else {
                                                player.quality = "abr";
                                                common.addClass(common.find(".fp-quality-selector li", root)[selectorIndex], qActive);
                                            }
                                            break;
                                        case "ERROR":
                                            switch (data.error) {
                                                case "download":
                                                    fperr = 4;
                                                    break;
                                                case "manifestError":
                                                    fperr = 5;
                                                    break;
                                                case "mediasource":
                                                    switch (e.event) {
                                                        case "MEDIA_ERR_DECODE":
                                                            fperr = 3;
                                                            break;
                                                        case "MEDIA_ERR_SRC_NOT_SUPPORTED":
                                                            fperr = 5;
                                                            break;
                                                        case "MEDIA_ERR_NETWORK":
                                                            fperr = 2;
                                                            break;
                                                        case "MEDIA_ERR_ABORTED":
                                                            fperr = 1;
                                                            break;
                                                    }
                                                    break;
                                            }
                                            if (fperr) {
                                                errobj = {
                                                    code: fperr
                                                };
                                                if (fperr > 2) {
                                                    errobj.video = extend(video, {
                                                        src: src,
                                                        url: data.event.url || src
                                                    });
                                                }
                                                player.trigger('error', [player, errobj]);
                                                return;
                                            }
                                            break;
                                    }

                                    if (expose) {
                                        player.trigger(fpEventType, [player, data]);
                                    }
                                });
                            });

                            common.prepend(common.find(".fp-player", root)[0], videoTag);
                            mediaPlayer.initialize(videoTag, video.src, autoplay);


                            // at least some Android requires extra load
                            // https://github.com/flowplayer/flowplayer/issues/910
                            if (autoplay && !flowplayer.support.zeropreload) {
                                videoTag.load();
                            }

                        } else {
                            if ((player.video.src && video.src !== player.video.src) || video.index) {
                                mediaPlayer.setAutoPlay(true);
                            }
                            mediaPlayer.attachSource(video.src);

                        }

                        // update video object before ready
                        player.video = video;
                    },

                    resume: function() {
                        videoTag.play();
                    },

                    pause: function() {
                        videoTag.pause();
                    },

                    seek: function(time) {
                        videoTag.currentTime = time;
                    },

                    volume: function(level) {
                        if (videoTag) {
                            videoTag.volume = level;
                        }
                    },

                    speed: function(val) {
                        videoTag.playbackRate = val;
                        player.trigger('speed', [player, val]);
                    },

                    unload: function() {
                        if (mediaPlayer) {
                            var listeners = "." + engineName;

                            mediaPlayer.reset();
                            mediaPlayer = 0;
                            player.off(listeners);
                            bean.off(root, listeners);
                            bean.off(videoTag, listeners);
                            common.removeNode(videoTag);
                            videoTag = 0;
                        }
                    }
                };



            // pre 6.0.4: no boolean api.conf.poster and no poster with autoplay
            if (/^6\.0\.[0-3]$/.test(version) &&
                !player.conf.splash && !player.conf.poster && !player.conf.autoplay) {
                bc = common.css(root, 'backgroundColor');
                // spaces in rgba arg mandatory for recognition
                has_bg = common.css(root, 'backgroundImage') !== "none" ||
                    (bc && bc !== "rgba(0, 0, 0, 0)" && bc !== "transparent");
                if (has_bg) {
                    player.conf.poster = true;
                }
            }

            return engine;
        };

    if (mse && typeof mse.isTypeSupported === "function" && version.indexOf("5.") !== 0) {
        // only load engine if it can be used
        engineImpl.engineName = engineName; // must be exposed
        engineImpl.canPlay = function(type, conf) {
            /*
              WARNING: MediaSource.isTypeSupported very inconsistent!
              e.g. Safari ignores codecs entirely, even bogus, like codecs="XYZ"
              example avc3 main level 3.1 + aac_he: avc3.4d401f; mp4a.40.5
              example avc1 high level 4.1 + aac_lc: avc1.640029; mp4a.40.2
              default: avc1 baseline level 3.0 + aac_lc
            */
            // inject dash conf at earliest opportunity
            dashconf = extend({
                type: "video/mp4",
                codecs: "avc1.42c01e,mp4a.40.2"
            }, flowplayer.conf[engineName], conf[engineName], conf.clip[engineName]);

            return dashCanPlay(type, dashconf.type, dashconf.codecs);
        };

        // put on top of engine stack
        // so mpegedash is tested before html5
        flowplayer.engines.unshift(engineImpl);

    }

}.apply(null, (typeof module === 'object' && module.exports) ? [require('flowplayer'), require('dashjs')] : [window.flowplayer, window.dashjs]));

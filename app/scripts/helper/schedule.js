/**
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

self.IOWA = self.IOWA || {};

class Schedule {

  /**
   * Name of the local DB table keeping the queued updates to the API endpoint.
   * @static
   * @constant
   * @type {string}
   */
  static get QUEUED_SESSION_API_UPDATES_DB_NAME() {
    return 'toolbox-offline-session-updates';
  }

  /**
   * Schedule API endpoint.
   * @static
   * @constant
   * @type {string}
   */
  static get SCHEDULE_ENDPOINT() {
    return 'api/v1/schedule';
  }

  /**
   * Survey API endpoint.
   * @static
   * @constant
   * @type {string}
   */
  static get SURVEY_ENDPOINT() {
    return 'api/v1/user/survey';
  }

  constructor() {
    this.scheduleData_ = null;

    this.cache = {
      userSavedSessions: [],
      userSavedSurveys: []
    };

    // A promise fulfilled by the loaded schedule.
    this.scheduleDeferredPromise = null;

    // The resolve function for scheduleDeferredPromise;
    this.scheduleDeferredPromiseResolver = null;
  }

  /**
   * Create the deferred schedule-fetching promise `scheduleDeferredPromise`.
   * @private
   */
  createScheduleDeferred_() {
    let scheduleDeferred = IOWA.Util.createDeferred();
    this.scheduleDeferredPromiseResolver = scheduleDeferred.resolve;
    this.scheduleDeferredPromise = scheduleDeferred.promise.then(data => {
      this.scheduleData_ = data.scheduleData;

      let template = IOWA.Elements.Template;
      template.set('app.scheduleData', data.scheduleData);
      template.set('app.filterSessionTypes', data.tags.filterSessionTypes);
      template.set('app.filterThemes', data.tags.filterThemes);
      template.set('app.filterTopics', data.tags.filterTopics);

      return this.scheduleData_;
    });
  }

  /**
   * Fetches the I/O schedule data. If the schedule has not been loaded yet, a
   * network request is kicked off. To wait on the schedule without
   * triggering a request for it, use `schedulePromise`.
   * @return {Promise} Resolves with response schedule data.
   */
  fetchSchedule() {
    if (this.scheduleData_) {
      return Promise.resolve(this.scheduleData_);
    }

    return IOWA.Request.xhrPromise('GET', Schedule.SCHEDULE_ENDPOINT, false).then(resp => {
      this.scheduleData_ = resp;
      return this.scheduleData_;
    });
  }

  /**
   * Returns a promise fulfilled when the master schedule is loaded.
   * @return {!Promise} Resolves with response schedule data.
   */
  schedulePromise() {
    if (!this.scheduleDeferredPromise) {
      this.createScheduleDeferred_();
    }

    return this.scheduleDeferredPromise;
  }

  /**
   * Resolves the schedule-fetching promise.
   * @param {{scheduleData, tags}} data
   */
  resolveSchedulePromise(data) {
    if (!this.scheduleDeferredPromiseResolver) {
      this.createScheduleDeferred_();
    }

    this.scheduleDeferredPromiseResolver(data);
  }

  /**
   * Fetches the resource from cached value storage or network.
   * If this is the first time it's been called, then uses the cache-then-network strategy to
   * first try to read the data stored in the Cache Storage API, and invokes the callback with that
   * response. It then tries to fetch a fresh copy of the data from the network, saves the response
   * locally in memory, and resolves the promise with that response.
   * @param {string} url The address of the resource.
   * @param {string} resourceCache A variable name to store the cached resource.
   * @param {function} callback The callback to execute when the user survey data is available.
   */
  // TODO: change and use this to cache Firebase requests instead of API requests.
  // TODO: Might want to move all caching logic inside IOFirebase (not sure).
  // TODO: Currently this is not being called.
  // TODO: Might be best to change that to a "read from cache" instead of keeping it as a more
  // TODO: generic "fetch" that does both cache+fetch because that's not really how Firebase works.
  // TODO: Firebase relies only on events.
  fetchResource(url, resourceCache, callback) {
    if (this.cache[resourceCache].length) {
      callback(this.cache[resourceCache]);
    } else {
      let callbackWrapper = resource => {
        this.cache[resourceCache] = resource || [];
        callback(this.cache[resourceCache]);
      };

      IOWA.Request.cacheThenNetwork(url, callback, callbackWrapper, true);
    }
  }

  /**
   * Wait for the master schedule to have loaded, then use `IOFirebase.registerToSessionUpdates()`
   * to fetch the initial user's schedule, bind it for display and listen for further updates.
   * registerToSessionUpdates() doesn't wait for the user to be signed in, so ensure that there is a
   * signed-in user before calling this function.
   */
  loadUserSchedule() {
    // Only fetch their schedule if the worker has responded with the master schedule.
    this.schedulePromise().then(() => {
      IOWA.Elements.Template.set('app.scheduleFetchingUserData', true);

      // TODO: read user schedule and saved surveys list from cache first.

      IOWA.Auth.waitForSignedIn('Sign in to add events to My Schedule').then(() => {
        // Listen to session bookmark updates.
        IOWA.IOFirebase.registerToSessionUpdates((sessionId, data) => {
          let template = IOWA.Elements.Template;
          template.set('app.scheduleFetchingUserData', false);
          let savedSessions = template.app.savedSessions;
          let savedSessionsListIndex = savedSessions.indexOf(sessionId);
          let sessionsListIndex = template.app.scheduleData.sessions.findIndex(
              session => session.id === sessionId);
          if (data && data.bookmarked && savedSessions.indexOf(sessionId) === -1) {
            // Add session to bookmarked sessions.
            template.push('app.savedSessions', sessionId);
            template.set(`app.scheduleData.sessions.${sessionsListIndex}.saved`, true);

            if (window.ENV !== 'prod') {
              console.log(`Session ${sessionId} bookmarked!`);
            }
          } else if (data && !data.bookmarked && savedSessionsListIndex !== -1) {
            // Remove the session from the bookmarks if present.
            template.splice('app.savedSessions', savedSessionsListIndex, 1);
            template.set(`app.scheduleData.sessions.${sessionsListIndex}.saved`, false);

            if (window.ENV !== 'prod') {
              console.log(`Session ${sessionId} removed from bookmarks!`);
            }
          }
        });

        // Listen to feedback updates.
        IOWA.IOFirebase.registerToFeedbackUpdates(sessionId => {
          let template = IOWA.Elements.Template;
          let savedFeedback = template.app.savedSurveys;
          let sessionsListIndex = template.app.scheduleData.sessions.findIndex(
            session => session.id === sessionId);
          if (savedFeedback.indexOf(sessionId) === -1) {
            // Add feedback to saved feedbacks.
            template.push('app.savedSurveys', sessionId);
            template.set(`app.scheduleData.sessions.${sessionsListIndex}.rated`, true);

            if (window.ENV !== 'prod') {
              console.log(`Session ${sessionId} has received feedback!`);
            }
          }
        });
      });
    });
  }

  /**
   * Adds/removes a session from the user's bookmarked sessions.
   * @param {string} sessionId The session to add/remove.
   * @param {Boolean} save True if the session should be added, false if it
   *     should be removed.
   * @return {Promise} Resolves with the server's response.
   */
  saveSession(sessionId, save) {
    IOWA.Analytics.trackEvent('session', 'bookmark', save ? 'save' : 'remove');
    return IOWA.Auth.waitForSignedIn('Sign in to add events to My Schedule').then(() => {
      IOWA.Elements.Template.set('app.scheduleFetchingUserData', true);
      return IOWA.IOFirebase.toggleSession(sessionId, save)
          .then(() => this.clearCachedUserSchedule())
          .catch(error => IOWA.Elements.Toast.showMessage(
              error + ' The change will be retried on your next visit.'));
    });
  }

  /**
   * Submits session-related request to backend.
   * @param {string} url Request url.
   * @param {string} method Request method, e.g. 'PUT'.
   * @param {Object} payload JSON payload.
   * @param {string} errorMsg Message to be shown on error.
   * @param {function} callback Callback to be called with the resource.
   * @return {Promise} Resolves with the server's response.
   */
  submitSessionRequest(url, method, payload, errorMsg, callback) {
    return IOWA.Request.xhrPromise(method, url, true, payload)
      .then(callback.bind(this))
      .catch(error => {
        // error will be an XMLHttpRequestProgressEvent if the xhrPromise()
        // was rejected due to a network error.
        // Otherwise, error will be a Error object.
        if ('serviceWorker' in navigator && XMLHttpRequestProgressEvent &&
          error instanceof XMLHttpRequestProgressEvent) {
          IOWA.Elements.Toast.showMessage(
            errorMsg + ' The change will be retried on your next visit.');
        } else {
          IOWA.Elements.Toast.showMessage(errorMsg);
        }
        throw error;
      });
  }

  /**
   * Submits session survey results.
   * @param {string} sessionId The session to be rated.
   * @param {Object} answers An object with question/answer pairs.
   * @return {Promise} Resolves with the server's response.
   */
  saveSurvey(sessionId, answers) {
    IOWA.Analytics.trackEvent('session', 'rate', sessionId);

    return IOWA.Auth.waitForSignedIn('Sign in to submit feedback').then(() => {
      let url = `${Schedule.SURVEY_ENDPOINT}/${sessionId}`;
      let callback = response => {
        IOWA.Elements.Template.set('app.savedSurveys', response);
        IOWA.IOFirebase.markSessionRated(sessionId);
      };
      return this.submitSessionRequest(
        url, 'PUT', answers, 'Unable to save feedback results.', callback);
    });
  }

  /**
   * Shows a notification when bookmarking/removing a session.
   * @param {Boolean} saved True if the session was saved. False if it was removed.
   * @param {string=} opt_message Optional override message for the
   * "Added to My Schedule" toast.
   */
  bookmarkSessionNotification(saved, opt_message) {
    let message = opt_message || 'You\'ll get a notification when it starts.';
    let template = IOWA.Elements.Template;

    if (saved) {
      // If IOWA.Elements.Template.dontAutoSubscribe is true, this promise will reject immediately,
      // and we'll just add the session without attempting to auto-subscribe.
      return IOWA.Notifications.subscribePromise(template.app.dontAutoSubscribe).then(() => {
        IOWA.Elements.Toast.showMessage('Added to My Schedule. ' + message);
      }).catch(error => {
        template.set('app.dontAutoSubscribe', true);
        if (error && error.name === 'AbortError') {
          // AbortError indicates that the subscription couldn't be completed due to the page
          // permissions for notifications being set to denied.
          IOWA.Elements.Toast.showMessage('Added to My Schedule. Want to enable notifications?',
              null, 'Learn how', () => window.open('permissions', '_blank'));
        } else {
          // If the subscription failed for some other reason, like because we're not
          // auto-subscribing, show the normal toast.
          IOWA.Elements.Toast.showMessage('Added to My Schedule.');
        }
      });
    }
    IOWA.Elements.Toast.showMessage('Removed from My Schedule');
  }

  generateFilters(tags = {}) {
    let filterSessionTypes = [];
    let filterThemes = [];
    let filterTopics = [];

    let sortedTags = Object.keys(tags).map(tag => {
      return tags[tag];
    }).sort((a, b) => {
      if (a.order_in_category < b.order_in_category) {
        return -1;
      }
      if (a.order_in_category > b.order_in_category) {
        return 1;
      }
      return 0;
    });

    for (let i = 0; i < sortedTags.length; ++i) {
      let tag = sortedTags[i];
      switch (tag.category) {
        case 'TYPE':
          filterSessionTypes.push(tag.name);
          break;
        case 'TOPIC':
          filterTopics.push(tag.name);
          break;
        case 'THEME':
          filterThemes.push(tag.name);
          break;
      }
    }

    return {
      filterSessionTypes: filterSessionTypes,
      filterThemes: filterThemes,
      filterTopics: filterTopics
    };
  }

  clearCachedUserSchedule() {
    this.cache.userSavedSessions = [];
  }

  /**
   * Clear all user schedule data from display.
   */
  clearUserSchedule() {
    let template = IOWA.Elements.Template;
    template.set('app.savedSessions', []);
    Schedule.updateSavedSessionsUI(template.app.savedSessions);
    this.clearCachedUserSchedule();
  }

  getSessionById(sessionId) {
    for (let i = 0; i < this.scheduleData_.sessions.length; ++i) {
      let session = this.scheduleData_.sessions[i];
      if (session.id === sessionId) {
        return session;
      }
    }
    return null;
  }

  /**
   * Checks to see if there are any failed schedule update requests queued in IndexedDB, and if so,
   * replays them. Should only be called when auth is available, i.e. after login.
   *
   * @return {Promise} Resolves once the replay attempts are done, whether or not they succeeded.
   */
  // TODO: Not sure of this is ever called now. Might need to change this to Firebase stuff.
  replayQueuedRequests() {
    // Only bother checking for queued requests if we're on a browser with service worker support,
    // since they can't be queued otherwise. This has a side effect of working around a bug in
    // Safari triggered by the simpleDB library.
    if ('serviceWorker' in navigator) {
      // Replay the queued /API requests.
      let queuedSessionApiUpdates = simpleDB.open(Schedule.QUEUED_SESSION_API_UPDATES_DB_NAME).then(
        db => {
          let replayPromises = [];
          // forEach is a special method implemented by SimpleDB. It's not the normal Array.forEach.
          return db.forEach(function(url, method) {
            let replayPromise = IOWA.Request.xhrPromise(method, url, true).then(function() {
              return db.delete(url).then(function() {
                return true;
              });
            });
            replayPromises.push(replayPromise);
          }).then(() => {
            if (replayPromises.length) {
              return Promise.all(replayPromises).then(() =>
                IOWA.Elements.Toast.showMessage('My Schedule was updated with offline changes.'));
            }
          });
        }).catch(() => {
          IOWA.Elements.Toast.showMessage('Offline changes could not be applied to My Schedule.');
        });

      return Promise.all([queuedSessionApiUpdates]);
    }

    return Promise.resolve();
  }

  /**
   * Deletes the IndexedDB database used to queue up failed requests.
   * Useful when, e.g., the user has logged out.
   *
   * @static
   * @return {Promise} Resolves once the IndexedDB database is deleted.
   */
  static clearQueuedRequests() {
    return simpleDB.delete(Schedule.QUEUED_SESSION_UPDATES_DB_NAME);
  }
}

IOWA.Schedule = IOWA.Schedule || new Schedule();
